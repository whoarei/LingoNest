import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useLearning } from "../src/useLearning";
import { decodeState, emptyState } from "../src/storage";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", {});
});
async function boot() {
  const app = useLearning();
  await vi.waitFor(() => expect(app.ready.value).toBe(true));
  return app;
}
async function start() {
  const app = await boot();
  await app.addLearner("测试昵称");
  await app.confirmCourse();
  app.startStage("S1");
  await vi.waitFor(() => expect(app.currentExercise.value).not.toBeNull());
  return app;
}
describe("local learning service", () => {
  it("saves exactly one attempt for concurrent submission and restores feedback after restart", async () => {
    const app = await start();
    const ex = app.currentExercise.value!;
    app.selectedIds.value = [...ex.correctOptionIds!];
    await Promise.all([app.submit(), app.submit()]);
    expect(app.history.value).toHaveLength(1);
    expect(app.feedback.value?.passed).toBe(true);
    const restored = await boot();
    restored.startStage("S1");
    await vi.waitFor(() => expect(restored.feedback.value?.passed).toBe(true));
    expect(restored.currentExercise.value?.id).toBe(ex.id);
    expect(restored.history.value).toHaveLength(1);
    await Promise.all([restored.next(), restored.next()]);
    expect(restored.practice.value.position).toBe(1);
  });
  it("persists hint eligibility across restart and excludes hinted answers from stage checks", async () => {
    const app = await start();
    await app.revealHint();
    const restored = await boot();
    restored.startStage("S1");
    await vi.waitFor(() => expect(restored.hintShown.value).toBe(true));
    restored.selectedIds.value = [
      ...restored.currentExercise.value!.correctOptionIds!,
    ];
    await restored.submit();
    expect(restored.history.value[0]!.hintLevel).toBe(1);
    expect(restored.stages.value[0]!.done).toBe(0);
    expect(restored.stats.value.measured).toBe(0);
  });
  it("blocks stage bypass and does not create due reviews just by viewing the textbook", async () => {
    const app = await start();
    await app.openLesson();
    await nextTick();
    await vi.waitFor(() => expect(app.busy.value).toBe(false));
    expect(app.stats.value.dueCount).toBe(0);
    app.startStage("S7");
    expect(app.view.value).toBe("lesson");
    app.startReview();
    expect(app.view.value).toBe("lesson");
  });
  it("isolates learners and deletes only the selected profile", async () => {
    const app = await start();
    const first = app.learner.value!.id;
    app.selectedIds.value = [...app.currentExercise.value!.correctOptionIds!];
    await app.submit();
    await app.addLearner("另一位同学");
    await vi.waitFor(() => expect(app.busy.value).toBe(false));
    expect(app.history.value).toHaveLength(0);
    await app.deleteLearner();
    expect(app.learner.value!.id).toBe(first);
    expect(app.history.value).toHaveLength(1);
    expect(app.learners.value).toHaveLength(1);
  });
});
describe("storage envelope validation", () => {
  it("roundtrips a fresh state and rejects an unknown version without resetting it", () => {
    expect(decodeState(JSON.stringify(emptyState()))).toEqual(emptyState());
    expect(() =>
      decodeState(JSON.stringify({ ...emptyState(), formatVersion: 2 })),
    ).toThrow();
  });
  it("rejects dangling profiles and unsafe deletion paths", () => {
    expect(() =>
      decodeState(
        JSON.stringify({ ...emptyState(), activeLearnerId: "missing" }),
      ),
    ).toThrow();
    expect(() =>
      decodeState(
        JSON.stringify({ ...emptyState(), pendingDeletions: ["../outside"] }),
      ),
    ).toThrow();
  });
});
