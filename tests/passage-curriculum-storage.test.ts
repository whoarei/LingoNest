import { describe, expect, it } from "vitest";
import { setupCatalog, materialInput } from "./fixtures/shared-catalog";
import { compilePassagePackage, makePassageAudioManifest } from "../packages/learning-modes/passage-path/authoring";
import { fixtureCurriculumDraft, responseFor } from "./fixtures/passage-path";
import { passageSourceFromMaterial } from "../src/modes/passage-path/material";
import { questionFor } from "../packages/learning-modes/passage-path/references";
import { createApplicationServices } from "../src/application/services";
import { sevenKey } from "./fixtures/application-state";

describe("curriculum recording ownership and durable cleanup", () => {
  it("preserves a partial oral lesson and all retakes through archive/restore, then resumes a failed recording purge", async () => {
    const env = setupCatalog(), services = env.services, courseId = await services.catalog.createMaterial(materialInput());
    await services.catalog.assignCourse("legacy-a", courseId);
    const material = services.catalog.snapshot().courses.find(item => item.id === courseId)!;
    const pkg = compilePassagePackage({ source: passageSourceFromMaterial(material), draft: fixtureCurriculumDraft(), modeInstanceId: "instance-1", revision: "rich-1", model: "test", generatedAt: "2026-10-17T10:00:00.000Z" });
    const ctx = { activeModeId: "passage-path", learnerId: "legacy-a", courseId, courses: [{ courseId, available: true, audioReady: true }], clock: { at: "2026-10-17T10:00:00.000Z", trusted: true } };
    const store = services.passage.createStore(() => ctx); await store.load();
    await store.publish(pkg, { reviewedAt: ctx.clock.at, audioAssetIds: makePassageAudioManifest(pkg).assets.map(asset => asset.id) });
    for (const id of ["discover", "transfer", "communicate"]) {
      await store.dispatch({ type: "start", sessionId: id, seed: 7 });
      while (store.snapshot().sessions.at(-1)!.status === "active") {
        const state = store.snapshot(), run = state.sessions.at(-1)!;
        if (questionFor(state, run.queue[run.index]!).kind === "speak") break;
        await store.dispatch({ type: "submit", sessionId: id, index: run.index, attemptId: `${id}-${run.index}`, response: responseFor(state, id) });
        await store.dispatch({ type: "next", sessionId: id, index: run.index });
      }
    }
    const active = store.snapshot().sessions.at(-1)!;
    for (const name of ["first", "second"]) await store.dispatch({ type: "input", sessionId: active.id, index: active.index,
      response: { text: "", selectedIds: [], oral: { recordingPath: `recordings/legacy-a/${name}.m4a` } } });
    const before = store.snapshot(), seven = env.values.get(sevenKey);
    expect(before.sessions.at(-1)!.recordingPaths).toEqual(["recordings/legacy-a/first.m4a", "recordings/legacy-a/second.m4a"]);
    expect(before.completions).toHaveLength(0);
    await services.catalog.archiveCourse(courseId); await services.catalog.restoreCourse(courseId); await services.catalog.assignCourse("legacy-a", courseId);
    expect(await services.passage.state.refresh()).toEqual(before);
    await services.catalog.archiveCourse(courseId);
    env.cleanup.mockImplementation(async resource => { if (resource.kind === "recording") throw Error("录音暂不可清理"); });
    await expect(services.catalog.purgeCourse(courseId)).rejects.toThrow("录音暂不可清理");
    const restarted = createApplicationServices(env.cleanup); await restarted.boot();
    expect(restarted.deletions.pendingTargets()).toEqual([{ kind: "course", id: courseId }]);
    expect((await restarted.passage.state.refresh()).sessions.some(session => session.courseId === courseId)).toBe(false);
    env.cleanup.mockResolvedValue(); await restarted.retryCleanup();
    expect(restarted.deletions.pendingTargets()).toEqual([]);
    expect(env.cleanup.mock.calls.filter(([resource]) => resource.kind === "recording").map(([resource]) => resource.kind === "recording" ? resource.path : "")).toContain("recordings/legacy-a/second.m4a");
    expect(env.values.get(sevenKey)).toBe(seven);
    expect(restarted.catalog.snapshot().learners.map(learner => learner.id)).toContain("legacy-b");
  });
});
