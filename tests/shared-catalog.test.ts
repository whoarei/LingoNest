import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLearning } from "../src/modes/seven-step/useLearning";
import { decodeState, emptyState } from "../packages/learning-modes/seven-step/state";
import { makePassageAudioManifest } from "../packages/learning-modes/passage-path/authoring";
import { beginShared, materialInput, materialPackage, setupCatalog } from "./fixtures/shared-catalog";
import { responseFor } from "./fixtures/passage-path";
import legacy from "./fixtures/seven-step-legacy.json";
import { buildCoursePackage } from "../packages/learning-modes/seven-step/authoring";

let env: ReturnType<typeof setupCatalog>;
beforeEach(() => { env = setupCatalog(); });

describe("shared catalogue compatibility", () => {
  it("projects existing identities and materials without writing or migrating the legacy snapshot", async () => {
    const raw = env.values.get(legacy.storageKey);
    const first = await env.services.catalog.read(), second = await env.services.catalog.read();
    expect(first).toEqual(second);
    expect(first.learners).toEqual(legacy.snapshot.learners);
    expect(first.learningCourseIds).toEqual(legacy.snapshot.learningCourseIds);
    expect(first.courses).toHaveLength(legacy.snapshot.courses.length + 1);
    expect(first.courses[0]!.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
    expect(first.courses.every(course => !("package" in course) && !("vocabulary" in course) && !("status" in course))).toBe(true);
    expect(env.values.get(legacy.storageKey)).toBe(raw);
    expect([...env.values.keys()]).toEqual([legacy.storageKey]);
  });
  it("reads a version-one catalogue through the existing migration without eagerly rewriting it", async () => {
    const state: Record<string, unknown> = { ...emptyState(), formatVersion: 1, learners: legacy.snapshot.learners, activeLearnerId: "legacy-a", confirmedLearnerIds: ["legacy-a"] };
    delete state.courses; delete state.learningCourseIds; delete state.confirmedCourses;
    const raw = JSON.stringify({ revision: 3, payload: JSON.stringify(state) }); env.values.set(legacy.storageKey, raw);
    const catalog = await env.services.catalog.read();
    expect(catalog.learners).toEqual(legacy.snapshot.learners);
    expect(catalog.courses).toHaveLength(1);
    expect(env.values.get(legacy.storageKey)).toBe(raw);
    expect(env.services.sevenStep.state.snapshot().confirmedCourses).toContainEqual({ learnerId: "legacy-a", courseId: catalog.defaultCourseId, version: "0.1.0" });
  });
  it("creates a material-only course under the same ID and blocks seven-step without pretending stages are complete", async () => {
    const courseId = await env.services.catalog.createMaterial(materialInput());
    await env.services.catalog.assignCourse("legacy-a", courseId);
    const stored = decodeState(JSON.parse(env.values.get(legacy.storageKey)!).payload);
    expect(stored.courses.find(item => item.id === courseId)).toMatchObject({ status: "source", package: null, recipe: null });
    expect(stored.events).toEqual(legacy.snapshot.events); expect(stored.runs).toEqual(legacy.snapshot.runs);
    const scope = effectScope();
    const app = scope.run(() => useLearning({ services: env.services.sevenStep }))!;
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      expect(app.course.value.id).toBe(courseId); expect(app.exercises.value).toEqual([]); expect(app.stages.value).toEqual([]);
      expect(app.courseMode.value).toMatchObject({ status: "draft", canLearn: false });
      app.startStage("S1"); await app.confirmCourse(); await app.submit();
      expect(app.view.value).toBe("home"); expect(app.history.value).toHaveLength(0);
      expect(env.services.sevenStep.state.snapshot().events).toEqual(legacy.snapshot.events);
    } finally { scope.stop(); }
  });
  it("rebases shared and seven-step mutations without overwriting the other child's rename or learning progress", async () => {
    const scope = effectScope();
    const app = scope.run(() => useLearning({ services: env.services.sevenStep }))!;
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      await Promise.all([app.renameLearner("甲的新昵称"), env.services.catalog.renameLearner("legacy-b", "乙的新昵称")]);
      const state = env.services.sevenStep.state.snapshot();
      expect(state.learners.map(item => item.nickname)).toEqual(["甲的新昵称", "乙的新昵称"]);
      expect(state.events).toEqual(legacy.snapshot.events); expect(state.runs).toEqual(legacy.snapshot.runs);
      expect(state.courses).toEqual(legacy.snapshot.courses);
      expect(app.learners.value).toEqual(state.learners);
    } finally { scope.stop(); }
  });
  it("keeps original raw bytes on failed shared writes and changes material revision only when material changes", async () => {
    await env.services.sevenStep.boot();
    const raw = env.values.get(legacy.storageKey);
    env.control.failWrite = key => key === legacy.storageKey;
    await expect(env.services.catalog.renameLearner("legacy-a", "未保存")).rejects.toThrow("保存失败");
    expect(env.values.get(legacy.storageKey)).toBe(raw);
    expect(env.services.catalog.selection().activeLearnerId).toBe("legacy-a");
    env.control.failWrite = () => false;
    const courseId = await env.services.catalog.createMaterial(materialInput());
    const before = (await env.services.catalog.read()).courses.find(item => item.id === courseId)!.sourceRevision;
    await env.services.catalog.renameLearner("legacy-a", "已保存");
    expect((await env.services.catalog.read()).courses.find(item => item.id === courseId)!.sourceRevision).toBe(before);
    await env.services.catalog.updateMaterial(courseId, { ...materialInput(), images: [{ ...materialInput().images[0]!, rotation: 180 }] });
    expect((await env.services.catalog.read()).courses.find(item => item.id === courseId)!.sourceRevision).not.toBe(before);
  });
  it("rejects an obsolete source candidate and freezes materials after any mode publishes", async () => {
    const courseId = await env.services.catalog.createMaterial(materialInput());
    await env.services.catalog.assignCourse("legacy-a", courseId);
    const pkg = await materialPackage(env.services, courseId);
    const store = env.services.passage.createStore(() => ({ activeModeId: "passage-path", learnerId: "legacy-a", courseId,
      courses: [{ courseId, available: true, audioReady: true }], clock: { at: "2026-10-17T10:00:00.000Z", trusted: true } }));
    await store.load();
    await env.services.catalog.updateMaterial(courseId, { ...materialInput(), images: [] });
    await expect(store.publish(pkg, { reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: makePassageAudioManifest(pkg).assets.map(item => item.id) })).rejects.toThrow("教材已变化");
    expect(store.snapshot().publications).toEqual([]);
    const updated = await materialPackage(env.services, courseId);
    await store.publish(updated, { reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: makePassageAudioManifest(updated).assets.map(item => item.id) });
    await expect(env.services.catalog.updateMaterial(courseId, materialInput())).rejects.toThrow("已发布");
    expect((await env.services.catalog.read()).courses.find(item => item.id === courseId)?.sourceEditable).toBe(false);
  });
  it("invalidates only unpublished generated content when shared material changes and keeps existing learning history", async () => {
    const original = decodeState(JSON.stringify(legacy.snapshot)).courses[0]!;
    const courseId = await env.services.catalog.createMaterial({ title: "可编辑的学习草稿", subtitle: "", sourceText: original.sourceText, images: [], supplementImages: [] });
    await env.services.data.state.update(state => {
      const draft = state.courses.find(item => item.id === courseId)!;
      draft.vocabulary = structuredClone(original.vocabulary);
      draft.recipe = structuredClone(original.recipe);
      draft.status = "review";
      draft.package = buildCoursePackage(draft);
    });
    const before = env.services.data.state.snapshot();
    const material = (await env.services.catalog.read()).courses.find(item => item.id === courseId)!;
    expect(material.sourceEditable).toBe(true);
    await env.services.catalog.updateMaterial(courseId, { ...material, sourceText: "I love my family. My father is a teacher." });
    const after = env.services.data.state.snapshot();
    expect(after.courses.find(item => item.id === courseId)).toMatchObject({ status: "source", recipe: null, package: null });
    expect(after.courses[0]).toEqual(before.courses[0]);
    expect(after.events).toEqual(before.events); expect(after.runs).toEqual(before.runs);
  });
  it("makes runtime identity and availability follow the real shared selection, not a stale caller context", async () => {
    const { store, courseId } = await beginShared(env.services);
    const original = store.snapshot();
    await env.services.catalog.selectLearner("legacy-b");
    await expect(store.dispatch({ type: "submit", sessionId: "session-a", index: 0, attemptId: "stale", response: responseFor(original, "session-a") })).rejects.toThrow("选择已变化");
    expect(store.snapshot()).toEqual(original);
    await env.services.catalog.selectLearner("legacy-a");
    const raw = env.values.get("lingonest.passage-path.v1");
    await env.services.catalog.archiveCourse(courseId);
    expect(env.values.get("lingonest.passage-path.v1")).toBe(raw);
    expect(env.services.catalog.selection().learningCourseIds["legacy-a"]).toBeUndefined();
    await expect(store.dispatch({ type: "start", sessionId: "stale", seed: 1 })).rejects.toThrow("选择已变化");
    await env.services.catalog.restoreCourse(courseId);
    expect(env.services.catalog.selection().learningCourseIds["legacy-a"]).toBeUndefined();
    await env.services.catalog.assignCourse("legacy-a", courseId);
    await store.dispatch({ type: "start", sessionId: "unused", seed: 100 });
    expect(store.snapshot()).toEqual(original);
  });
  it("accepts existing hexadecimal learner IDs that start with a digit", async () => {
    const numericId = "1234567890abcdef1234567890abcdef";
    const envelope = JSON.parse(env.values.get(legacy.storageKey)!);
    envelope.payload = envelope.payload.replaceAll('"legacy-a"', `"${numericId}"`);
    env.values.set(legacy.storageKey, JSON.stringify(envelope));
    const courseId = await env.services.catalog.createMaterial(materialInput());
    await env.services.catalog.assignCourse(numericId, courseId);
    const store = env.services.passage.createStore(() => ({ activeModeId: "passage-path", learnerId: numericId, courseId,
      courses: [{ courseId, available: true, audioReady: true }], clock: { at: "2026-10-17T10:00:00.000Z", trusted: true } }));
    await store.load(); const pkg = await materialPackage(env.services, courseId);
    await store.publish(pkg, { reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: makePassageAudioManifest(pkg).assets.map(item => item.id) });
    await store.dispatch({ type: "start", sessionId: "numeric-id-session", seed: 7 });
    expect(store.snapshot().sessions[0]!.learnerId).toBe(numericId);
    expect(env.services.sevenStep.state.snapshot().events[0]!.learnerId).toBe(numericId);
  });
  it("refreshes a selection changed by another page before saving a passage answer", async () => {
    const { store } = await beginShared(env.services);
    const envelope = JSON.parse(env.values.get(legacy.storageKey)!), state = JSON.parse(envelope.payload);
    state.activeLearnerId = "legacy-b";
    env.values.set(legacy.storageKey, JSON.stringify({ revision: envelope.revision + 1, payload: JSON.stringify(state) }));
    const before = env.values.get("lingonest.passage-path.v1");
    await expect(store.dispatch({ type: "submit", sessionId: "session-a", index: 0, attemptId: "stale-page", response: responseFor(store.snapshot(), "session-a") })).rejects.toThrow("选择已变化");
    expect(env.values.get("lingonest.passage-path.v1")).toBe(before);
  });
});
