import type { MaterialCourse } from "./catalog";

/** Platform contracts deliberately contain no stages, exercise types or mastery rules. */
export interface SourceImage {
  path: string;
  rotation: 0 | 90 | 180 | 270;
}

export interface LearnerProfile {
  id: string;
  nickname: string;
  createdAt: string;
}

export interface CourseAudioManifest {
  courseId: string;
  courseVersion: string;
  title: string;
  assets: { id: string; text: string }[];
}

export interface SnapshotCodec<TState> {
  /** Retained by the mode, including legacy formats and explicit migrations. */
  storageKey: string;
  empty(): TState;
  decode(payload: string): TState;
}

export interface TeachingModeIdentity {
  id: string;
  version: string;
  title: string;
}

/** Each mode owns the types and algorithms behind these four entry points. */
export interface TeachingModeCore<TState, TAuthoring, TRuntime, TReporting> {
  identity: Readonly<TeachingModeIdentity>;
  state: SnapshotCodec<TState>;
  authoring: TAuthoring;
  runtime: TRuntime;
  reporting: TReporting;
}

export interface TeachingModeRegistration<TExperience> {
  identity: Readonly<TeachingModeIdentity>;
  /** A scoped teaching workspace; application navigation is provided by its host. */
  loadExperience(): Promise<TExperience>;
  /** Public scope is projected by the host, including pending deletions. */
  readOverview?(learnerId: string | null, materials: readonly MaterialCourse[]): Promise<ModeOverview>;
}

export interface ModeOverview {
  courses: { courseId: string; status: "missing" | "draft" | "review" | "ready"; pending?: boolean }[];
  records: ModeRecord[];
  pendingCount: number;
  canConfirm?: boolean;
  resources?: { label: string; manifest: CourseAudioManifest; current?: boolean }[];
}

/** Read-only facts supplied by a mode; the frame does not interpret its grading. */
export interface ModeRecord {
  id: string;
  courseId: string;
  at: string;
  title: string;
  outcome?: string;
  summary?: string;
  details?: { label: string; value: string }[];
}

/** An explicit default is only for a new installation, never an unknown mode fallback. */
export function createTeachingModeRegistry<TExperience>(
  modes: readonly TeachingModeRegistration<TExperience>[],
  defaultModeId: string,
) {
  const entries = new Map<string, TeachingModeRegistration<TExperience>>();
  for (const registration of modes) {
    const { id, version, title } = registration.identity;
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !version.trim() || !title.trim())
      throw new Error("教学模式注册信息无效。");
    if (entries.has(id)) throw new Error(`教学模式重复注册：${id}`);
    entries.set(id, Object.freeze({
      identity: Object.freeze({ id, version, title }),
      loadExperience: registration.loadExperience,
      readOverview: registration.readOverview,
    }));
  }
  function requireMode(id: string) {
    const mode = entries.get(id);
    if (!mode) throw new Error(`教学模式尚未安装：${id}。已有内容和记录保留。`);
    return mode;
  }
  if (entries.size) requireMode(defaultModeId);
  return Object.freeze({
    defaultModeId,
    modes: Object.freeze([...entries.values()]),
    requireMode,
  });
}
