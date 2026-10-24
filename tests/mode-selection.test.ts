import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { createModeSelection, modeSettingsCodec } from "../src/platform/mode-selection";
import { teachingModes } from "../src/modes/registry";
import { sevenStepCourseAccess } from "../src/modes/seven-step/course-access";
import { starterRecord } from "../packages/learning-modes/seven-step/authoring";
import { useLearning } from "../src/modes/seven-step/useLearning";
import { createApplicationServices } from "../src/application/services";
import { seededDocuments, sevenKey } from "./fixtures/application-state";
import legacy from "./fixtures/seven-step-legacy.json";

const modes = [
  { identity: { id: "seven-step", version: "1", title: "七步学习" } },
  { identity: { id: "test-adaptive", version: "1", title: "测试模式" } },
];
const key = modeSettingsCodec("seven-step").storageKey;
let values: Map<string, string>;
let failSave: boolean;
beforeEach(() => {
  values = seededDocuments();
  failSave = false;
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { if (failSave && name === key) throw Error("模拟设置保存失败"); values.set(name, value); },
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", {});
});
describe("global mode selection", () => {
  it("persists the initial global choice independently without changing any teaching bytes", async () => {
    const old = values.get(sevenKey);
    const selection = createModeSelection(teachingModes.modes, teachingModes.defaultModeId);
    await selection.load();
    expect(selection.modes.map(mode => mode.id)).toEqual(["seven-step", "passage-path"]);
    expect(JSON.parse(JSON.parse(values.get(key)!).payload)).toEqual({ formatVersion: 1, activeModeId: "seven-step" });
    await selection.select("seven-step");
    expect(JSON.parse(values.get(key)!).revision).toBe(1);
    expect(values.get(sevenKey)).toBe(old);
    await expect(selection.select("test-adaptive")).rejects.toThrow("尚未安装");
  });
  it("waits for progress preparation before committing the single global choice and restores it on reload", async () => {
    const selection = createModeSelection(modes, "seven-step");
    await selection.load();
    let done!: () => void;
    const prepare = vi.fn(() => new Promise<void>(resolve => { done = resolve; }));
    const release = selection.beforeSwitch(prepare);
    const pending = selection.select("test-adaptive");
    expect(selection.busy.value).toBe(true);
    expect(selection.activeModeId.value).toBe("seven-step");
    expect(JSON.parse(JSON.parse(values.get(key)!).payload).activeModeId).toBe("seven-step");
    done(); await pending; release();
    expect(selection.activeModeId.value).toBe("test-adaptive");
    const restored = createModeSelection(modes, "seven-step");
    await restored.load();
    expect(restored.activeModeId.value).toBe("test-adaptive");
    await selection.select("seven-step");
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("does not switch or overwrite progress when preparation or saving fails", async () => {
    const selection = createModeSelection(modes, "seven-step");
    await selection.load();
    const settings = values.get(key), old = values.get(sevenKey);
    const release = selection.beforeSwitch(async () => { throw Error("进度保存失败"); });
    await expect(selection.select("test-adaptive")).rejects.toThrow("进度保存失败");
    release(); failSave = true;
    await expect(selection.select("test-adaptive")).rejects.toThrow("设置保存失败");
    expect(selection.activeModeId.value).toBe("seven-step");
    expect(selection.busy.value).toBe(false);
    expect(values.get(key)).toBe(settings);
    expect(values.get(sevenKey)).toBe(old);
  });
  it("preserves unknown installed-state choices without silently falling back, and protects malformed settings", async () => {
    values.set(key, JSON.stringify({ revision: 2, payload: JSON.stringify({ formatVersion: 1, activeModeId: "removed-mode" }) }));
    const selection = createModeSelection(modes, "seven-step");
    await selection.load();
    expect(selection.activeModeId.value).toBe("removed-mode");
    await selection.select("seven-step");
    const raw = JSON.stringify({ revision: 8, payload: '{"formatVersion":999}' });
    values.set(key, raw);
    const invalid = createModeSelection(modes, "seven-step");
    await expect(invalid.load()).rejects.toThrow("不受支持");
    await expect(invalid.select("seven-step")).rejects.toThrow("尚未就绪");
    expect(values.get(key)).toBe(raw);
  });
  it("rejects stale settings writes from another page", async () => {
    const a = createModeSelection(modes, "seven-step"); await a.load();
    const b = createModeSelection(modes, "seven-step"); await b.load();
    await a.select("test-adaptive");
    await expect(b.select("test-adaptive")).rejects.toThrow("另一个页面");
    expect(b.activeModeId.value).toBe("seven-step");
  });
});
describe("course mode readiness and seven-step recovery", () => {
  it.each([
    ["S1", "learner"], ["S1", "course"], ["S2", "learner"], ["S2", "course"],
  ] as const)("retains the inactive %s resume point when changing %s before switching modes", async (stage, kind) => {
    const selection = createModeSelection(modes, "seven-step"); await selection.load();
    const scope = effectScope();
    const app = scope.run(() => useLearning({ services: createApplicationServices().sevenStep, activeModeId: selection.activeModeId, modeChanging: selection.busy }))!;
    const release = selection.beforeSwitch(app.prepareModeChange);
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      app.startStage("S1");
      await vi.waitFor(() => expect(app.currentExercise.value?.stageId).toBe("S1"));
      const selected = [...app.currentExercise.value!.correctOptionIds!];
      app.selectedIds.value = selected;
      if (stage === "S2") {
        await app.submit(); await app.next(); app.startStage("S2");
        await vi.waitFor(() => expect(app.answer.value).toBe("fa"));
      }
      const exerciseId = app.currentExercise.value!.id;
      app.view.value = "parent"; await nextTick();
      await vi.waitFor(() => expect(app.busy.value).toBe(false));
      if (kind === "learner") await app.selectLearner("legacy-b");
      else expect(await app.assignCourse(starterRecord.id)).toBe(true);
      const before = values.get(sevenKey)!;
      expect(JSON.parse(JSON.parse(before).payload).runs[0]).toEqual(legacy.snapshot.runs[0]);
      await selection.select("test-adaptive");
      expect(values.get(sevenKey)).toBe(before);
      release(); scope.stop(); await selection.select("seven-step");
      expect(values.get(sevenKey)).toBe(before);
      const restoredScope = effectScope();
      try {
        const restored = restoredScope.run(() => useLearning({ services: createApplicationServices().sevenStep, activeModeId: selection.activeModeId }))!;
        await vi.waitFor(() => expect(restored.ready.value).toBe(true));
        if (kind === "learner") await restored.selectLearner("legacy-a");
        else expect(await restored.assignCourse(legacy.snapshot.courses[0]!.id)).toBe(true);
        restored.startStage(stage);
        await vi.waitFor(() => expect(restored.currentExercise.value?.id).toBe(exerciseId));
        if (stage === "S2") {
          expect(restored.answer.value).toBe("fa");
          expect(restored.hintShown.value).toBe(true);
        } else {
          expect(restored.selectedIds.value).toEqual(selected);
          expect(restored.feedback.value).toBeNull();
        }
        expect(restored.history.value.find(item => item.id === "legacy-attempt")!.grade).toEqual(legacy.snapshot.events[0]!.attempt.grade);
        const saved = JSON.parse(JSON.parse(values.get(sevenKey)!).payload);
        expect(saved.courses).toEqual(legacy.snapshot.courses);
        expect(saved.events).toEqual(JSON.parse(JSON.parse(before).payload).events);
        expect(saved.runs).toEqual(JSON.parse(JSON.parse(before).payload).runs);
      } finally { restoredScope.stop(); }
    } finally { release(); scope.stop(); }
  });
  it("requires an approved package for the selected mode on every course", () => {
    for (const course of [starterRecord, legacy.snapshot.courses[0]!]) {
      expect(sevenStepCourseAccess("seven-step", course as typeof starterRecord).canLearn).toBe(true);
      expect(sevenStepCourseAccess("test-adaptive", course as typeof starterRecord)).toMatchObject({ status: "missing", canLearn: false });
    }
    expect(sevenStepCourseAccess("seven-step", { ...starterRecord, status: "source" })).toMatchObject({ status: "draft", canLearn: false });
    expect(sevenStepCourseAccess("seven-step", { ...starterRecord, status: "review" })).toMatchObject({ status: "review", canLearn: false });
  });
  it("blocks seven-step learning under another global mode without altering old content, events or recovery points", async () => {
    const old = values.get(sevenKey);
    const activeModeId = ref("test-adaptive");
    const scope = effectScope();
    const app = scope.run(() => useLearning({ services: createApplicationServices().sevenStep, activeModeId }))!;
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      expect(app.courseMode.value.status).toBe("missing");
      app.startStage("S1"); await app.openLesson(); await app.confirmCourse(); await app.submit(); await app.revealHint();
      expect(app.view.value).toBe("home");
      expect(values.get(sevenKey)).toBe(old);
      activeModeId.value = "seven-step";
      expect(app.courseMode.value.canLearn).toBe(true);
      expect(app.history.value.map(item => item.id)).toEqual(["legacy-attempt"]);
    } finally { scope.stop(); }
  });
  it("saves an unsubmitted choice before switching and restores it after remounting seven-step", async () => {
    const selection = createModeSelection(modes, "seven-step");
    await selection.load();
    const scope = effectScope();
    const app = scope.run(() => useLearning({ services: createApplicationServices().sevenStep, activeModeId: selection.activeModeId, modeChanging: selection.busy }))!;
    const release = selection.beforeSwitch(app.prepareModeChange);
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      app.startStage("S1");
      await vi.waitFor(() => expect(app.currentExercise.value?.stageId).toBe("S1"));
      const exerciseId = app.currentExercise.value!.id;
      const choice = [...app.currentExercise.value!.correctOptionIds!];
      app.selectedIds.value = choice;
      await selection.select("test-adaptive");
      const saved = JSON.parse(JSON.parse(values.get(sevenKey)!).payload);
      expect(saved.events).toEqual(legacy.snapshot.events);
      expect(saved.courses).toEqual(legacy.snapshot.courses);
      expect(saved.runs.find((item: { stageId: string }) => item.stageId === "S1").selectedIds).toEqual(choice);
      release(); scope.stop();
      await selection.select("seven-step");
      const restoredScope = effectScope();
      try {
        const restored = restoredScope.run(() => useLearning({ services: createApplicationServices().sevenStep, activeModeId: selection.activeModeId }))!;
        await vi.waitFor(() => expect(restored.ready.value).toBe(true));
        restored.startStage("S1");
        await vi.waitFor(() => expect(restored.currentExercise.value?.id).toBe(exerciseId));
        expect(restored.selectedIds.value).toEqual(choice);
        expect(restored.history.value.map(item => item.id)).toEqual(["legacy-attempt"]);
      } finally { restoredScope.stop(); }
    } finally { release(); scope.stop(); }
  });
  it("blocks switching when a resume-point save fails and retains old text, hints and history on retry", async () => {
    const selection = createModeSelection(modes, "seven-step"); await selection.load();
    const scope = effectScope();
    const app = scope.run(() => useLearning({ services: createApplicationServices().sevenStep }))!;
    const release = selection.beforeSwitch(app.prepareModeChange);
    try {
      await vi.waitFor(() => expect(app.ready.value).toBe(true));
      app.startStage("S1");
      await vi.waitFor(() => expect(app.currentExercise.value?.stageId).toBe("S1"));
      app.selectedIds.value = [...app.currentExercise.value!.correctOptionIds!];
      await app.submit(); await app.next(); app.startStage("S2");
      await vi.waitFor(() => expect(app.answer.value).toBe("fa"));
      app.answer.value = "famil";
      const before = values.get(sevenKey)!;
      const originalSet = localStorage.setItem;
      vi.spyOn(localStorage, "setItem").mockImplementation((name, value) => {
        if (name === sevenKey) throw Error("模拟进度保存失败");
        originalSet(name, value);
      });
      await expect(selection.select("test-adaptive")).rejects.toThrow("模拟进度保存失败");
      expect(selection.activeModeId.value).toBe("seven-step");
      expect(values.get(sevenKey)).toBe(before);
      expect(app.answer.value).toBe("famil");
      vi.mocked(localStorage.setItem).mockRestore();
      await selection.select("test-adaptive");
      const saved = JSON.parse(JSON.parse(values.get(sevenKey)!).payload);
      const prior = JSON.parse(JSON.parse(before).payload);
      expect(saved.events).toEqual(prior.events);
      expect(saved.courses).toEqual(prior.courses);
      expect(saved.runs.find((item: { id: string }) => item.id === "legacy-resume")).toEqual({ ...legacy.snapshot.runs[0], answer: "famil" });
    } finally { release(); scope.stop(); }
  });
});
