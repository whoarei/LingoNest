import { inject, type InjectionKey, type Ref } from "vue";
import type { ModeSurface, ParentModeSurface } from "../../packages/learning-modes/contracts";
export type { ModeSurface } from "../../packages/learning-modes/contracts";

export interface ModeWorkspace {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly focused: boolean;
  readonly completed?: boolean;
  readonly loadError?: string;
  /** Reject on unsaved work; the host must abort navigation. */
  prepareLeave(): Promise<void>;
  handleBack(): Promise<boolean>;
  exit(): Promise<void>;
  /** Re-read owned data; the host contains read failures without blocking public navigation. */
  refresh(): Promise<void>;
  readMaterial?(): Promise<void>;
}
/** The application owns navigation and authorization; plugins own teaching views. */
export interface WorkspaceContext {
  modeId: Readonly<Ref<string>>;
  surface: Readonly<Ref<ModeSurface>>;
  courseId: Readonly<Ref<string | null>>;
  visible: Readonly<Ref<boolean>>;
  parent: Readonly<Ref<boolean>>;
  activation: Readonly<Ref<number>>;
  connect(workspace: ModeWorkspace): () => void;
  /** Settles after cancellation or the confirmed action, scoped to this activation. */
  authorize(label: string, action: () => Promise<void>): Promise<void>;
  /** Scoped to the requesting workspace's mode and course, including inactive modes. */
  openParent(surface?: ParentModeSurface): Promise<void>;
  openSettings(): Promise<void>;
  editMaterial(): Promise<void>;
  notify(message: string, kind?: "error" | "status"): void;
}
/** A connection belongs to one mounted experience, including its retry lifetime. */
export function createWorkspaceBridge(
  state: Pick<WorkspaceContext, "modeId" | "surface" | "courseId" | "visible" | "parent" | "activation">,
  commands: Pick<WorkspaceContext, "authorize" | "openParent" | "openSettings" | "editMaterial" | "notify">,
  attach: (workspace: ModeWorkspace) => () => void,
) {
  const owner = state.modeId.value;
  let alive = true, disconnect: (() => void) | undefined;
  const active = () => alive && state.modeId.value === owner;
  const visible = () => active() && state.visible.value;
  const scope = () => JSON.stringify([state.modeId.value, state.surface.value, state.courseId.value, state.activation.value]);
  const context: WorkspaceContext = { ...state,
    connect(workspace) {
      if (!active()) return () => {};
      disconnect?.(); const release = attach(workspace); disconnect = release;
      return () => { release(); if (disconnect === release) disconnect = undefined; };
    },
    async authorize(label, action) {
      if (!visible()) return;
      const expected = scope();
      await commands.authorize(label, async () => { if (visible() && scope() === expected) await action(); });
    },
    async openParent(surface) { if (visible()) await commands.openParent(surface); },
    async openSettings() { if (visible()) await commands.openSettings(); },
    async editMaterial() { if (visible()) await commands.editMaterial(); },
    notify(message, kind) { if (visible()) commands.notify(message, kind); },
  };
  return { context, dispose() { alive = false; disconnect?.(); disconnect = undefined; } };
}
export const workspaceKey: InjectionKey<WorkspaceContext> = Symbol("application-mode-workspace");
export function useWorkspace() {
  const workspace = inject(workspaceKey);
  if (!workspace) throw Error("学习模式未连接应用框架。");
  return workspace;
}
