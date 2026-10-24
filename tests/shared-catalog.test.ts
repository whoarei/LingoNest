import { effectScope, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationServices } from "../src/application/services";
import { useLearning } from "../src/modes/seven-step/useLearning";
import { recordForMaterial } from "../src/modes/seven-step/services";
import { catalogStateCodec, emptyCatalogState } from "../packages/learning-modes/catalog-state";
import { sevenStepStateCodec } from "../packages/learning-modes/seven-step/state";
import { passagePathStateCodec } from "../packages/learning-modes/passage-path/state";
import { makePassageAudioManifest } from "../packages/learning-modes/passage-path/authoring";
import { buildCoursePackage } from "../packages/learning-modes/seven-step/authoring";
import { beginShared, materialInput, materialPackage, setupCatalog, sharedImage } from "./fixtures/shared-catalog";
import { catalogKey, sevenKey, sampleSeven, envelope } from "./fixtures/application-state";
import { responseFor } from "./fixtures/passage-path";
import sample from "./fixtures/seven-step-legacy.json";
let env: ReturnType<typeof setupCatalog>;
beforeEach(() => { env = setupCatalog(); });
const read = (key: string) => JSON.parse(JSON.parse(env.values.get(key)!).payload);
async function controller(courseId?: string) {
  const scope = effectScope(), app = scope.run(() => useLearning({ services: env.services.sevenStep, courseId: courseId ? ref(courseId) : undefined }))!;
  await vi.waitFor(() => expect(app.ready.value).toBe(true)); return { scope, app };
}
async function materialRecord(id: string) { return recordForMaterial((await env.services.catalog.read()).courses.find(item => item.id === id)!); }

describe("independent public catalogue", () => {
  it("ignores old combined snapshots and starts without loading an unreadable seven-step document", async () => {
    env.values.delete(catalogKey); env.values.set(sample.storageKey, "{bad old data"); env.values.set(sevenKey, envelope({ formatVersion: 999 }));
    const catalog = await createApplicationServices(env.cleanup).catalog.read();
    expect(catalog.learners).toEqual([]); expect(catalog.courses).toEqual(emptyCatalogState().courses.map(item => ({ ...item, sourceEditable: false })));
    expect(env.values.get(sample.storageKey)).toBe("{bad old data");
  });
  it("owns identities, materials, revisions and selections without creating seven-step content", async () => {
    const seven = env.values.get(sevenKey), id = await env.services.catalog.createMaterial(materialInput());
    await env.services.catalog.assignCourse("legacy-a", id);
    const stored = read(catalogKey);
    expect(stored.courses.find((item: any) => item.id === id)).toMatchObject({ sourceText: materialInput().sourceText, archivedAt: null });
    expect(stored.courses.every((item: any) => !("package" in item) && !("vocabulary" in item) && !("status" in item))).toBe(true);
    expect(stored.learningCourseIds["legacy-a"]).toBe(id); expect(env.values.get(sevenKey)).toBe(seven);
    const { scope, app } = await controller();
    try { expect(app.course.value.id).toBe(id); expect(app.stages.value).toEqual([]); expect(app.courseMode.value.canLearn).toBe(false); }
    finally { scope.stop(); }
  });
  it("allows profile and material creation when either mode is unreadable while blocking unsafe material edits", async () => {
    const id = await env.services.catalog.createMaterial(materialInput());
    for (const key of [sevenKey, passagePathStateCodec.storageKey]) {
      const raw = envelope({ formatVersion: 999 }); env.values.set(key, raw);
      const catalog = await env.services.catalog.read();
      expect(catalog.courses.find(item => item.id === id)).toMatchObject({ sourceEditable: false, sourceEditBlockedReason: expect.any(String) });
      await env.services.catalog.renameLearner("legacy-b", "仍可管理");
      await env.services.catalog.createMaterial({ ...materialInput(), title: "独立教材" });
      await expect(env.services.catalog.updateMaterial(id, materialInput())).rejects.toThrow();
      expect(env.values.get(key)).toBe(raw);
    }
  });
  it("updates only public storage for profile changes and teaching writes cannot replace shared source", async () => {
    const { courseId } = await beginShared(env.services), record = await materialRecord(courseId);
    const { scope, app } = await controller();
    try {
      const seven = env.values.get(sevenKey);
      await app.renameLearner("新的昵称"); expect(env.values.get(sevenKey)).toBe(seven);
      record.vocabulary.push({ term: "team", meaning: "队伍", example: "", selected: true, origin: "manual" });
      const catalog = env.values.get(catalogKey); expect(await app.saveCourse(record)).toBe(true); expect(env.values.get(catalogKey)).toBe(catalog);
      const committed = env.values.get(sevenKey);
      for (const changed of [{ ...record, sourceText: "Another source." }, { ...record, title: "Changed" }, { ...record, images: [] }, { ...record, vocabularyImages: [sharedImage] }]) {
        expect(await app.saveCourse(changed)).toBe(false); expect(env.values.get(sevenKey)).toBe(committed);
      }
    } finally { scope.stop(); }
  });
  it("invalidates a teaching draft by source projection without a cross-document partial update", async () => {
    const id = await env.services.catalog.createMaterial({ ...materialInput(), sourceText: sampleSeven().courses[0]!.sourceText }), record = await materialRecord(id);
    const { scope, app } = await controller();
    try {
      Object.assign(record, { vocabulary: structuredClone(sampleSeven().courses[0]!.vocabulary), recipe: structuredClone(sampleSeven().courses[0]!.recipe), status: "review" });
      record.package = buildCoursePackage(record); expect(await app.saveCourse(record)).toBe(true);
      const seven = env.values.get(sevenKey);
      await env.services.catalog.updateMaterial(id, { ...materialInput(), sourceText: "Updated material." });
      expect(env.values.get(sevenKey)).toBe(seven);
      expect(app.courses.value.find(item => item.id === id)).toMatchObject({ status: "source", sourceText: "Updated material.", package: null });
      expect(await app.saveCourse(record)).toBe(false); expect(env.values.get(sevenKey)).toBe(seven);
    } finally { scope.stop(); }
  });
  it("keeps material revisions stable for unrelated changes and public writes atomic on failure", async () => {
    const id = await env.services.catalog.createMaterial(materialInput());
    const before = read(catalogKey), revision = before.courses.find((item: any) => item.id === id).sourceRevision;
    await env.services.catalog.renameLearner("legacy-a", "已保存");
    expect(read(catalogKey).courses.find((item: any) => item.id === id).sourceRevision).toBe(revision);
    const raw = env.values.get(catalogKey); env.control.failWrite = key => key === catalogKey;
    await expect(env.services.catalog.updateMaterial(id, { ...materialInput(), title: "未保存" })).rejects.toThrow("保存失败");
    expect(env.values.get(catalogKey)).toBe(raw); env.control.failWrite = () => false;
    await env.services.catalog.updateMaterial(id, { ...materialInput(), title: "已更新" });
    expect(read(catalogKey).courses.find((item: any) => item.id === id).sourceRevision).not.toBe(revision);
  });
  it("freezes source after either mode publishes and rejects obsolete passage candidates", async () => {
    const id = await env.services.catalog.createMaterial(materialInput()); await env.services.catalog.assignCourse("legacy-a", id);
    const pkg = await materialPackage(env.services, id);
    const store = env.services.passage.createStore(() => ({ activeModeId: "passage-path", learnerId: "legacy-a", courseId: id,
      courses: [{ courseId: id, available: true, audioReady: true }], clock: { at: "2026-10-17T10:00:00.000Z", trusted: true } }));
    await store.load(); await env.services.catalog.updateMaterial(id, { ...materialInput(), images: [] });
    const approval = (pack: typeof pkg) => ({ reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: makePassageAudioManifest(pack).assets.map(item => item.id) });
    await expect(store.publish(pkg, approval(pkg))).rejects.toThrow("教材已变化");
    const updated = await materialPackage(env.services, id); await store.publish(updated, approval(updated));
    await expect(env.services.catalog.updateMaterial(id, materialInput())).rejects.toThrow("已发布");
    await expect(env.services.catalog.updateMaterial(sample.snapshot.courses[0]!.id, materialInput())).rejects.toThrow("已发布");
  });
  it("preserves reports and mode bytes through archive/restore, with explicit historical course identity", async () => {
    const id = sample.snapshot.courses[0]!.id, seven = env.values.get(sevenKey);
    await env.services.catalog.archiveCourse(id); expect(env.values.get(sevenKey)).toBe(seven);
    const { scope, app } = await controller(id);
    try {
      expect(app.course.value.id).toBe(id); expect(app.history.value.map(item => item.id)).toEqual(["legacy-attempt"]); expect(app.courseMode.value.canLearn).toBe(false);
      await env.services.catalog.restoreCourse(id); expect(env.values.get(sevenKey)).toBe(seven); expect(env.services.catalog.selection().learningCourseIds["legacy-a"]).toBeUndefined();
    } finally { scope.stop(); }
    const missing = await controller("user.ffffffffffffffffffffffffffffffff");
    try { expect(missing.app.course.value.id).toBe("user.ffffffffffffffffffffffffffffffff"); expect(missing.app.exercises.value).toEqual([]); }
    finally { missing.scope.stop(); }
  });
  it("checks the latest public selection before accepting either mode's stale commands", async () => {
    const { store } = await beginShared(env.services), original = store.snapshot();
    const catalog = read(catalogKey); catalog.activeLearnerId = "legacy-b"; env.values.set(catalogKey, envelope(catalog, 50));
    const raw = env.values.get(passagePathStateCodec.storageKey);
    await expect(store.dispatch({ type: "submit", sessionId: "session-a", index: 0, attemptId: "stale", response: responseFor(original, "session-a") })).rejects.toThrow("选择已变化");
    expect(env.values.get(passagePathStateCodec.storageKey)).toBe(raw);
  });
  it("detaches an unfinished seven-step run when selection changes through the public catalog", async () => {
    const { scope, app } = await controller();
    try {
      app.startStage("S1"); await vi.waitFor(() => expect(app.currentExercise.value).not.toBeNull());
      const before = env.values.get(sevenKey);
      await env.services.catalog.selectLearner("legacy-b");
      expect(app.learner.value?.id).toBe("legacy-b"); expect(app.view.value).toBe("home"); expect(app.currentExercise.value).toBeNull();
      expect(env.values.get(sevenKey)).toBe(before);
    } finally { scope.stop(); }
  });
  it("validates only public schema and rejects accidental teaching payloads and dangling assignments", () => {
    const state = emptyCatalogState(); expect(catalogStateCodec.decode(JSON.stringify(state))).toEqual(state);
    expect(() => catalogStateCodec.decode(JSON.stringify({ ...state, events: [] }))).toThrow();
    expect(() => catalogStateCodec.decode(JSON.stringify({ ...state, learningCourseIds: { missing: state.defaultCourseId } }))).toThrow();
    expect(Object.keys(sevenStepStateCodec.empty()).sort()).toEqual(["confirmedCourses", "courses", "events", "formatVersion", "lastObservedAt", "runs"]);
  });
});
