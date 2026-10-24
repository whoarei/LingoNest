import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceBridge, type ModeWorkspace } from "../src/application/workspace";
import { createTeachingModeRegistry, type ModeSurface } from "../packages/learning-modes/contracts";
import { createModeSelection, modeSelectionView } from "../src/platform/mode-selection";

function fixture() {
  const state = { modeId: ref("seven-step"), surface: ref<ModeSurface>("learning"), courseId: ref<string | null>("course-a"),
    visible: ref(true), parent: ref(false), activation: ref(1) };
  const commands = { authorize: vi.fn(async (_label: string, action: () => Promise<void>) => { await action(); }),
    openParent: vi.fn(async () => {}), openSettings: vi.fn(async () => {}), editMaterial: vi.fn(async () => {}), notify: vi.fn() };
  let connected: ModeWorkspace | null = null;
  const attach = vi.fn((workspace: ModeWorkspace) => { connected = workspace; return () => { if (connected === workspace) connected = null; }; });
  const bridge = createWorkspaceBridge(state, commands, attach);
  return { state, commands, attach, bridge, connected: () => connected };
}
const adapter = (): ModeWorkspace => ({ ready: true, busy: false, focused: false,
  prepareLeave: async () => {}, handleBack: async () => false, exit: async () => {}, refresh: async () => {} });

describe("mode host interfaces", () => {
  it.each(["course", "mode", "surface", "activation", "hidden", "disposed"])("ignores a deferred parent action after its requesting scope changes: %s", async change => {
    const env = fixture(); let approval!: () => Promise<void>, release!: () => void;
    env.commands.authorize.mockImplementation(async (_label, action) => {
      approval = action; await new Promise<void>(resolve => { release = resolve; }); await approval();
    });
    const action = vi.fn(async () => {}), pending = env.bridge.context.authorize("发布", action);
    if (change === "course") env.state.courseId.value = "course-b";
    if (change === "mode") env.state.modeId.value = "passage-path";
    if (change === "surface") env.state.surface.value = "report";
    if (change === "activation") env.state.activation.value++;
    if (change === "hidden") env.state.visible.value = false;
    if (change === "disposed") env.bridge.dispose();
    release(); await pending; expect(action).not.toHaveBeenCalled();
  });

  it("waits for an authorized action while the original scope remains active", async () => {
    const env = fixture(); let finish!: () => void;
    const action = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    let completed = false;
    const pending = env.bridge.context.authorize("保存", action).then(() => { completed = true; });
    await Promise.resolve(); expect(completed).toBe(false); finish(); await pending; expect(completed).toBe(true);
  });

  it("invalidates callbacks and connections when an experience is disposed", async () => {
    const env = fixture(), original = adapter(); env.bridge.context.connect(original);
    expect(env.connected()).toBe(original); env.bridge.dispose(); expect(env.connected()).toBeNull();
    await env.bridge.context.openParent("authoring"); await env.bridge.context.openSettings(); await env.bridge.context.editMaterial();
    env.bridge.context.notify("旧模式的错误", "error"); env.bridge.context.connect(adapter());
    expect(env.commands.openParent).not.toHaveBeenCalled(); expect(env.commands.openSettings).not.toHaveBeenCalled();
    expect(env.commands.editMaterial).not.toHaveBeenCalled(); expect(env.commands.notify).not.toHaveBeenCalled();
    expect(env.attach).toHaveBeenCalledTimes(1);
  });

  it("does not disconnect the replacement adapter when an old connection releases", () => {
    const env = fixture(), old = adapter(), current = adapter();
    const release = env.bridge.context.connect(old); env.bridge.context.connect(current); release();
    expect(env.connected()).toBe(current);
  });

  it("declares confirmation capability independently of overview availability", () => {
    const loadExperience = async () => null;
    const registry = createTeachingModeRegistry([
      { identity: { id: "seven-step", title: "七步", version: "1" }, surfaces: ["learning", "confirm"], confirmationLabel: "口语确认", loadExperience },
      { identity: { id: "passage-path", title: "闯关", version: "1" }, surfaces: ["learning", "report"], loadExperience },
    ], "seven-step");
    expect(registry.requireSurface("seven-step", "confirm").confirmationLabel).toBe("口语确认");
    expect(() => registry.requireSurface("passage-path", "confirm")).toThrow("不支持");
    expect(Object.isFrozen(registry.requireMode("seven-step").surfaces)).toBe(true);
    for (const declaration of [{ surfaces: ["learning", "confirm"] }, { surfaces: ["learning", "learning"] }, { surfaces: ["report"] },
      { surfaces: ["learning"], confirmationLabel: "不支持的确认" }]) {
      expect(() => createTeachingModeRegistry([{ identity: { id: "invalid", title: "错误", version: "1" }, loadExperience, ...declaration } as any], "invalid")).toThrow("入口声明无效");
    }
  });

  it("provides only immutable mode information to experiences", () => {
    const selection = createModeSelection([{ identity: { id: "seven-step", title: "七步", version: "1" } }], "seven-step");
    const view = modeSelectionView(selection);
    expect(view).not.toHaveProperty("select"); expect(view).not.toHaveProperty("load"); expect(view).not.toHaveProperty("beforeSwitch");
    expect(view.activeModeId).toBe(selection.activeModeId);
    expect(Object.isFrozen(view)).toBe(true); expect(Object.isFrozen(view.modes)).toBe(true);
    expect(Object.isFrozen(view.modes[0])).toBe(true);
  });
});
