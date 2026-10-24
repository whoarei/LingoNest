import { effectScope, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationServices } from "../src/application/services";
import { useLearning } from "../src/modes/seven-step/useLearning";
import { deletionStateCodec } from "../src/platform/deletions";
import { starterRecord } from "../packages/learning-modes/seven-step/authoring";
import { readOverview as readSevenOverview } from "../src/modes/seven-step/overview";
import { readOverview as readPassageOverview } from "../src/modes/passage-path/overview";
import { envelope, sampleSeven, sevenKey } from "./fixtures/application-state";
import { beginShared, materialInput, setupCatalog } from "./fixtures/shared-catalog";
import { responseFor } from "./fixtures/passage-path";

let env: ReturnType<typeof setupCatalog>;
beforeEach(() => { env = setupCatalog(); });

describe("public-data separation review", () => {
  it("recovers independent deletion plans even if an earlier plan still fails", async () => {
    const first = await env.services.catalog.createMaterial({ ...materialInput(), images: [materialInput().images[0]!] });
    const second = await env.services.catalog.createMaterial({ ...materialInput(), images: [materialInput().images[1]!] });
    for (const id of [first, second]) await env.services.catalog.archiveCourse(id);
    env.cleanup.mockRejectedValue(Error("资源暂时不可删除"));
    for (const id of [first, second]) await expect(env.services.catalog.purgeCourse(id)).rejects.toThrow("暂时不可删除");
    env.cleanup.mockImplementation(async resource => {
      if (resource.kind === "image" && resource.path === materialInput().images[0]!.path) throw Error("第一项仍失败");
    });
    const restarted = createApplicationServices(env.cleanup); await restarted.boot();
    const state = deletionStateCodec.decode(JSON.parse(env.values.get(deletionStateCodec.storageKey)!).payload);
    expect(state.plans.map(plan => plan.target.id)).toEqual([first]);
    expect(state.completed.map(target => target.id)).toContain(second);
  });

  it("clears the startup cleanup error after a successful retry", async () => {
    const id = await env.services.catalog.createMaterial(materialInput());
    await env.services.catalog.archiveCourse(id);
    env.cleanup.mockRejectedValue(Error("资源暂时不可删除"));
    await expect(env.services.catalog.purgeCourse(id)).rejects.toThrow();
    const restarted = createApplicationServices(env.cleanup); await restarted.sevenStep.boot();
    expect(restarted.sevenStep.startupError).toContain("暂时不可删除");
    env.cleanup.mockResolvedValue(); await restarted.retryCleanup();
    expect(restarted.sevenStep.startupError).toBe("");
    expect(restarted.deletions.pendingTargets()).toEqual([]);
  });

  it.each(["archive", "scope"])("rejects a queued seven-step exposure after its scoped course changes: %s", async kind => {
    const id = sampleSeven().courses[0]!.id;
    await env.services.catalog.assignCourse("legacy-a", starterRecord.id);
    const courseId = ref<string | null>(id), scope = effectScope();
    const app = scope.run(() => useLearning({ services: env.services.sevenStep, courseId }))!;
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      const before = env.values.get(sevenKey);
      let release!: () => void;
      const blocker = env.services.sevenStep.queue.run(() => new Promise<void>(resolve => { release = resolve; }));
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      const archive = kind === "archive" ? env.services.catalog.archiveCourse(id) : Promise.resolve();
      const exposure = app.openLesson();
      if (kind === "scope") courseId.value = starterRecord.id;
      release(); await blocker; await archive; await exposure;
      expect(env.values.get(sevenKey)).toBe(before);
      expect(app.error.value).toMatch(/上下文|不可用/);
    } finally { scope.stop(); }
  });

  it("keeps an interrupted learner deletion blocked across restart without changing the other child", async () => {
    await env.services.boot();
    const before = sampleSeven();
    const original = before.events.find(event => event.type === "attempt")!;
    before.events.push({ ...original, id: "child-b-event", learnerId: "legacy-b",
      attempt: { ...original.attempt, id: "child-b-attempt", learnerId: "legacy-b", clientEventId: "child-b-client" } });
    env.values.set(sevenKey, envelope(before, 30));
    env.control.failWrite = key => key === sevenKey;
    await expect(env.services.catalog.deleteLearner("legacy-a")).rejects.toThrow("保存失败");
    const restarted = createApplicationServices(env.cleanup); await restarted.boot();
    expect(restarted.catalog.snapshot().learners.map(item => item.id)).toEqual(["legacy-b"]);
    env.control.failWrite = () => false; await restarted.retryCleanup();
    const after = await restarted.sevenStep.state.refresh();
    expect(after.events).toEqual(before.events.filter(event => event.learnerId === "legacy-b"));
    expect(restarted.catalog.selection().activeLearnerId).toBe("legacy-b");
  });

  it("notifies public subscribers when a durable deletion blocks a still-present profile", async () => {
    await env.services.boot();
    const changed = vi.fn(), unsubscribe = env.services.catalog.subscribe(changed);
    try {
      env.control.failWrite = key => key === sevenKey;
      await expect(env.services.catalog.deleteLearner("legacy-a")).rejects.toThrow();
      const projected = changed.mock.calls.at(-1)?.[0];
      expect(projected?.activeLearnerId).toBeNull();
      expect(projected?.learners.map((item: { id: string }) => item.id)).toEqual(["legacy-b"]);
    } finally { unsubscribe(); }
  });

  it("projects both mode overviews through the host's public deletion scope", async () => {
    const { courseId, store } = await beginShared(env.services);
    await store.dispatch({ type: "submit", sessionId: "session-a", index: 0, attemptId: "visible-attempt", response: responseFor(store.snapshot(), "session-a") });
    const seven = sampleSeven().courses[0]!.id;
    const materials = env.services.catalog.snapshot().courses.filter(item => item.id !== courseId && item.id !== seven);
    for (const read of [readSevenOverview, readPassageOverview]) {
      const overview = await read("legacy-a", materials);
      expect(overview.records).toEqual([]);
      expect(overview.courses.every(item => materials.some(material => material.id === item.courseId))).toBe(true);
      expect(overview.resources?.every(item => materials.some(material => material.id === item.manifest.courseId))).toBe(true);
    }
  });
});
