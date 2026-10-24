import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationServices } from "../src/application/services";
import { deletionStateCodec, resourceKey } from "../src/platform/deletions";
import { useLearning } from "../src/modes/seven-step/useLearning";
import { recordForMaterial } from "../src/modes/seven-step/services";
import { sampleSeven, sevenKey, catalogKey } from "./fixtures/application-state";
import { decodeState } from "../packages/learning-modes/seven-step/state";
import { decodePassageState, passagePathStateCodec } from "../packages/learning-modes/passage-path/state";
import { removePassageCourse } from "../packages/learning-modes/passage-path/deletion";
import { approve, context, finishSession, fixturePackage, responseFor, started } from "./fixtures/passage-path";
import { beginShared, materialInput, setupCatalog, sharedImage } from "./fixtures/shared-catalog";
import legacy from "./fixtures/seven-step-legacy.json";

let env: ReturnType<typeof setupCatalog>;
beforeEach(() => { env = setupCatalog(); });
const legacyState = () => decodeState(JSON.parse(env.values.get(sevenKey)!).payload);
const deletionState = () => deletionStateCodec.decode(JSON.parse(env.values.get(deletionStateCodec.storageKey)!).payload);

describe("cross-mode deletion transactions", () => {
  it("keeps public material references alive even when neither material has seven-step content", async () => {
    const first = await env.services.catalog.createMaterial(materialInput());
    const second = await env.services.catalog.createMaterial(materialInput());
    const seven = env.values.get(sevenKey);
    await env.services.catalog.archiveCourse(first); await env.services.catalog.purgeCourse(first);
    expect(env.cleanup.mock.calls.some(([resource]) => resource.kind === "image")).toBe(false);
    expect(env.values.get(sevenKey)).toBe(seven);
    await env.services.catalog.archiveCourse(second); await env.services.catalog.purgeCourse(second);
    expect(env.cleanup.mock.calls.filter(([resource]) => resource.kind === "image")).toHaveLength(2);
  });
  it("resumes a failed public-catalog removal after both teaching owners have committed", async () => {
    const { courseId } = await beginShared(env.services);
    await env.services.catalog.archiveCourse(courseId);
    env.control.failWrite = key => key === catalogKey;
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("保存失败");
    expect(deletionState().plans[0]!.removed).toEqual(["seven-step", "passage-path"]);
    expect(env.cleanup).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.parse(env.values.get(catalogKey)!).payload).courses.some((item: any) => item.id === courseId)).toBe(true);
    env.control.failWrite = () => false;
    const restarted = createApplicationServices(env.cleanup); await restarted.boot();
    expect((await restarted.catalog.read()).courses.some(item => item.id === courseId)).toBe(false);
    expect(deletionState().plans).toEqual([]);
    expect(deletionState().completed).toContainEqual({ kind: "course", id: courseId });
  });
  it("purges both modes while retaining another course's shared image and all unrelated seven-step progress", async () => {
    const raw = sampleSeven(); raw.courses[0]!.images = [sharedImage];
    env.values.set(sevenKey, JSON.stringify({ revision: 7, payload: JSON.stringify(raw) }));
    const { store, courseId } = await beginShared(env.services);
    const staleDraft = env.services.sevenStep.state.snapshot().courses.find(item => item.id === courseId)!;
    await env.services.catalog.archiveCourse(courseId);
    await env.services.catalog.purgeCourse(courseId);
    expect(store.snapshot().packages).toEqual([]); expect(store.snapshot().sessions).toEqual([]);
    const state = legacyState();
    expect(state.courses).toEqual(raw.courses); expect(state.events).toEqual(raw.events); expect(state.runs).toEqual(raw.runs);

    expect(env.cleanup.mock.calls.map(([resource]) => resource.kind === "image" ? resource.path : "")).not.toContain(sharedImage.path);
    expect(env.cleanup.mock.calls.some(([resource]) => resource.kind === "audio" && resource.course.courseId === courseId)).toBe(true);
    expect(deletionState()).toMatchObject({ plans: [], completed: [{ kind: "course", id: courseId }] });
    const scope = effectScope(); const app = scope.run(() => useLearning({ services: env.services.sevenStep }))!;
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      expect(await app.saveCourse(staleDraft)).toBe(false);
      expect(app.error.value).toContain("彻底删除");
    } finally { scope.stop(); }
    await expect(env.services.catalog.restoreCourse(courseId)).rejects.toThrow("彻底删除");
  });
  it("keeps a durable blocked plan after one mode save fails, and resumes on a fresh application instance", async () => {
    const { courseId, store } = await beginShared(env.services);
    await env.services.catalog.archiveCourse(courseId);
    env.control.failWrite = key => key === passagePathStateCodec.storageKey;
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("保存失败");
    expect(deletionState().plans[0]!.removed).toEqual(["seven-step"]);
    expect(env.services.deletions.isBlocked({ kind: "course", id: courseId })).toBe(true);
    expect(env.cleanup).not.toHaveBeenCalled();
    expect(store.snapshot().packages).toHaveLength(1);
    await expect(store.dispatch({ type: "start", sessionId: "forbidden", seed: 1 })).rejects.toThrow();
    env.control.failWrite = () => false;
    const restarted = createApplicationServices(env.cleanup); await restarted.sevenStep.boot();
    expect(restarted.passage.state.snapshot().packages).toEqual([]);
    expect(deletionState().plans).toEqual([]);
    expect(deletionState().completed).toContainEqual({ kind: "course", id: courseId });
    expect(restarted.sevenStep.state.snapshot().courses.some(item => item.id === courseId)).toBe(false);
  });
  it("repeats an already committed data removal when saving its completion marker failed", async () => {
    const { courseId } = await beginShared(env.services);
    await env.services.catalog.archiveCourse(courseId);
    let failed = false;
    env.control.failWrite = (key, value) => {
      if (key !== deletionStateCodec.storageKey || failed) return false;
      const state = JSON.parse(JSON.parse(value).payload);
      if (state.plans[0]?.removed.includes("seven-step")) { failed = true; return true; }
      return false;
    };
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("保存失败");
    expect(deletionState().plans[0]!.removed).toEqual([]);
    expect(legacyState().courses.some(item => item.id === courseId)).toBe(false);
    env.control.failWrite = () => false;
    await env.services.sevenStep.retryCleanup();
    expect(deletionState().plans).toEqual([]);
    expect(env.services.passage.state.snapshot().packages).toEqual([]);
  });
  it("resumes failed file cleanup without re-deleting data or cleaning an already completed resource twice", async () => {
    const { courseId } = await beginShared(env.services);
    await env.services.catalog.archiveCourse(courseId);
    const cleaned: string[] = []; let failed = false;
    env.cleanup.mockImplementation(async resource => {
      if (resource.kind === "audio" && !failed) { failed = true; throw Error("模拟文件清理失败"); }
      cleaned.push(resourceKey(resource));
    });
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("文件清理失败");
    const dataAfterRemoval = env.values.get(sevenKey);
    expect(deletionState().plans[0]!.removed).toEqual(["seven-step", "passage-path", "catalog"]);
    const alreadyCleaned = [...cleaned];
    const restarted = createApplicationServices(env.cleanup); await restarted.sevenStep.boot();
    expect(deletionState().plans).toEqual([]);
    expect(env.values.get(sevenKey)).toBe(dataAfterRemoval);
    expect(alreadyCleaned.every(key => cleaned.filter(value => value === key).length === 1)).toBe(true);
    expect(new Set(cleaned).size).toBe(cleaned.length);
  });
  it("cannot delete any mode's data before the durable plan itself has been saved", async () => {
    const { courseId } = await beginShared(env.services);
    await env.services.catalog.archiveCourse(courseId);
    const old = env.values.get(sevenKey), passage = env.values.get(passagePathStateCodec.storageKey);
    env.control.failWrite = key => key === deletionStateCodec.storageKey;
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("保存失败");
    expect(env.values.get(sevenKey)).toBe(old); expect(env.values.get(passagePathStateCodec.storageKey)).toBe(passage);
    expect(env.cleanup).not.toHaveBeenCalled();
  });
  it("prevents restore during an interrupted purge while allowing another child to remain usable", async () => {
    const { courseId } = await beginShared(env.services);
    await env.services.catalog.archiveCourse(courseId);
    env.control.failWrite = key => key === sevenKey;
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("保存失败");
    env.control.failWrite = () => false;
    const scope = effectScope(); const app = scope.run(() => useLearning({ services: env.services.sevenStep }))!;
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      expect(await app.restoreCourse(courseId)).toBe(false);
      expect(app.error.value).toContain("彻底删除");
      expect((await env.services.catalog.read()).courses.some(item => item.id === courseId)).toBe(false);
      await app.selectLearner("legacy-b");
      expect(app.learner.value!.id).toBe("legacy-b");
      await app.renameLearner("仍然可以使用");
      expect(app.learner.value!.nickname).toBe("仍然可以使用");
    } finally { scope.stop(); }
    await env.services.sevenStep.retryCleanup(); expect(deletionState().plans).toEqual([]);
  });
  it("preserves a plan with an unavailable data owner instead of deleting only the known mode", async () => {
    const target = { kind: "course" as const, id: legacy.snapshot.courses[0]!.id };
    const value = { formatVersion: 1, completed: [], plans: [{ id: "delete-future", target,
      participants: ["seven-step", "future-mode"], removed: [], resources: [], cleaned: [] }] };
    const raw = JSON.stringify({ revision: 1, payload: JSON.stringify(value) });
    env.values.set(deletionStateCodec.storageKey, raw);
    const before = env.values.get(sevenKey);
    await env.services.sevenStep.boot();
    expect(env.services.sevenStep.startupError).toContain("future-mode");
    expect(env.values.get(sevenKey)).toBe(before);
    expect(env.values.get(deletionStateCodec.storageKey)).toBe(raw);
    expect(env.cleanup).not.toHaveBeenCalled();
  });
  it("leaves seven-step readable if dormant mode data is unsupported, and refuses deletion before touching it", async () => {
    env.values.set(passagePathStateCodec.storageKey, JSON.stringify({ revision: 3, payload: '{"formatVersion":999}' }));
    const raw = env.values.get(sevenKey);
    await env.services.sevenStep.boot();
    expect(env.values.get(sevenKey)).toBe(raw);
    const courseId = legacy.snapshot.courses[0]!.id;
    await env.services.catalog.archiveCourse(courseId);
    const archived = env.values.get(sevenKey);
    await expect(env.services.catalog.purgeCourse(courseId)).rejects.toThrow("不支持");
    expect(env.values.get(sevenKey)).toBe(archived);
    expect(env.values.has(deletionStateCodec.storageKey)).toBe(false);
    expect(env.cleanup).not.toHaveBeenCalled();
  });
  it("removes a learner from every mode while retaining other learners and shared course content", async () => {
    const { courseId, store, setContext, getContext } = await beginShared(env.services);
    await store.dispatch({ type: "submit", sessionId: "session-a", index: 0, attemptId: "attempt-a", response: responseFor(store.snapshot(), "session-a") });
    await env.services.catalog.selectLearner("legacy-b"); await env.services.catalog.assignCourse("legacy-b", courseId);
    setContext({ ...getContext(), learnerId: "legacy-b" });
    await store.dispatch({ type: "start", sessionId: "session-b", seed: 3 });
    await store.dispatch({ type: "submit", sessionId: "session-b", index: 0, attemptId: "attempt-b", response: responseFor(store.snapshot(), "session-b") });
    const other = store.snapshot().attempts.filter(item => item.learnerId === "legacy-b");
    await env.services.catalog.deleteLearner("legacy-a");
    expect(store.snapshot().attempts).toEqual(other);
    expect(store.snapshot().sessions.map(item => item.learnerId)).toEqual(["legacy-b"]);
    expect(store.snapshot().packages).toHaveLength(1);
    expect(legacyState().events.every(item => item.learnerId !== "legacy-a")).toBe(true);
    expect(env.services.catalog.selection().activeLearnerId).toBe("legacy-b");
    expect(env.cleanup.mock.calls.every(([resource]) => resource.kind !== "audio" && resource.kind !== "image")).toBe(true);
    expect(() => decodePassageState(JSON.stringify(store.snapshot()))).not.toThrow();
  });
});

describe("removing a source from a mixed passage session", () => {
  it.each([false, true])("retains other-course facts and %s completion state after removing mixed review", complete => {
    const oldCourse = fixturePackage("course-previous");
    let state = approve(approve(), oldCourse);
    state = finishSession(started(state, context(oldCourse.courseId), "previous"), context(oldCourse.courseId), "previous", false);
    const ctx = context(undefined, undefined, "2026-10-19T10:00:00.000Z");
    ctx.courses.push({ courseId: oldCourse.courseId, available: true, audioReady: true });
    state = started(state, ctx, "mixed");
    expect(state.sessions.find(item => item.id === "mixed")!.queue.some(item => item.courseId === oldCourse.courseId)).toBe(true);
    if (complete) state = finishSession(state, ctx, "mixed");
    const keptAttempts = state.attempts.filter(item => item.item.courseId !== oldCourse.courseId);
    const keptCompletions = state.completions.filter(item => item.courseId !== oldCourse.courseId);
    const removed = removePassageCourse(state, oldCourse.courseId);
    expect(removed.attempts.map(({ index, ...attempt }) => attempt)).toEqual(keptAttempts.map(({ index, ...attempt }) => attempt));
    expect(removed.completions).toEqual(keptCompletions);
    expect(removed.sessions.find(item => item.id === "mixed")!.status).toBe(complete ? "completed" : "retired");
    expect(removed.sessions.every(session => session.queue.every(item => item.courseId !== oldCourse.courseId))).toBe(true);
    expect(decodePassageState(JSON.stringify(removed))).toEqual(removed);
    expect(removePassageCourse(removed, oldCourse.courseId)).toEqual(removed);
  });
});
