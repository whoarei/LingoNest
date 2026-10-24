import { inject, type InjectionKey, type Ref } from "vue";

export type ModeSurface = "learning" | "authoring" | "report" | "confirm";
export interface ModeWorkspace {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly focused: boolean;
  readonly completed?: boolean;
  prepareLeave(): Promise<void>;
  handleBack(): Promise<boolean>;
  exit(): Promise<void>;
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
  authorize(label: string, action: () => Promise<void>): Promise<void>;
  /** Scoped to the requesting workspace's mode and course, including inactive modes. */
  openParent(surface?: ModeSurface): Promise<void>;
  openSettings(): Promise<void>;
  editMaterial(): Promise<void>;
  notify(message: string, kind?: "error" | "status"): void;
}
export const workspaceKey: InjectionKey<WorkspaceContext> = Symbol("application-mode-workspace");
export function useWorkspace() {
  const workspace = inject(workspaceKey);
  if (!workspace) throw Error("学习模式未连接应用框架。");
  return workspace;
}
