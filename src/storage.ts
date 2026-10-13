import type { Learner } from "./domain";
import type {
  LearningEvent,
  StageId,
  CellRef,
  GradeResult,
} from "../packages/learning-engine/src/model";
import { exercises } from "./course";
import { isAndroid, native } from "./native";

// M1 envelope, intentionally distinct from the full schemaVersion 2.0.0 course-package contract.
export interface LocalState {
  formatVersion: 1;
  courseVersion: string;
  learners: Learner[];
  activeLearnerId: string | null;
  confirmedLearnerIds: string[];
  events: LearningEvent[];
  lastObservedAt: string | null;
  runs: PracticeRun[];
  pendingDeletions: string[];
}
export interface PracticeRun {
  id: string;
  learnerId: string;
  stageId: StageId | null;
  exerciseIds: string[];
  index: number;
  label: string;
  hints: Record<string, 0 | 1 | 3>;
  answer: string;
  selectedIds: string[];
  recordingPath: string | null;
}
export const emptyState = (): LocalState => ({
  formatVersion: 1,
  courseVersion: "0.1.0",
  learners: [],
  activeLearnerId: null,
  confirmedLearnerIds: [],
  events: [],
  lastObservedAt: null,
  runs: [],
  pendingDeletions: [],
});
const validText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const validTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const exerciseIds = new Set(exercises.map((e) => e.id));
const validCell = (value: CellRef) =>
  value &&
  validText(value.knowledgeId) &&
  [
    "meaning",
    "spelling",
    "usage",
    "readAloud",
    "recall",
    "dictation",
    "transfer",
  ].includes(value.ability) &&
  ["recognition", "written", "oral"].includes(value.mode);
function validGrade(grade: GradeResult) {
  return (
    grade &&
    ["local", "human"].includes(grade.source) &&
    grade.policyVersion === "2" &&
    typeof grade.feedback === "string" &&
    typeof grade.normalizedAnswer === "string" &&
    (grade.status === "scored"
      ? typeof grade.score === "number" &&
        Number.isFinite(grade.score) &&
        grade.score >= 0 &&
        grade.score <= 100 &&
        typeof grade.passed === "boolean"
      : ["needs_review", "unscorable"].includes(grade.status) &&
        grade.score === null &&
        grade.passed === null)
  );
}
export function decodeState(payload: string): LocalState {
  const s = JSON.parse(payload) as LocalState;
  if (
    s.formatVersion !== 1 ||
    s.courseVersion !== "0.1.0" ||
    !Array.isArray(s.learners) ||
    !Array.isArray(s.events) ||
    !Array.isArray(s.confirmedLearnerIds)
  )
    throw new Error("本地数据格式不受支持。为保护学习记录，已停止写入。");
  if (!Array.isArray(s.runs) || !Array.isArray(s.pendingDeletions))
    throw new Error("练习恢复数据格式不完整，已停止写入。");
  if (s.lastObservedAt !== null && !validTime(s.lastObservedAt))
    throw new Error("时间记录损坏，已停止写入。");
  const ids = new Set<string>();
  for (const l of s.learners) {
    if (
      !l ||
      typeof l.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(l.id) ||
      ids.has(l.id) ||
      typeof l.nickname !== "string" ||
      typeof l.createdAt !== "string"
    )
      throw new Error("学习档案损坏，已停止写入。");
    ids.add(l.id);
  }
  if (
    (s.activeLearnerId !== null && !ids.has(s.activeLearnerId)) ||
    s.confirmedLearnerIds.some((id) => !ids.has(id))
  )
    throw new Error("学习档案引用无效，已停止写入。");
  for (const run of s.runs) {
    if (
      !run ||
      !validText(run.id) ||
      !ids.has(run.learnerId) ||
      !Array.isArray(run.exerciseIds) ||
      run.exerciseIds.some((id) => !exerciseIds.has(id)) ||
      !Number.isInteger(run.index) ||
      run.index < 0 ||
      run.index > run.exerciseIds.length ||
      !run.hints ||
      Object.values(run.hints).some((level) => ![0, 1, 3].includes(level)) ||
      !Array.isArray(run.selectedIds) ||
      run.selectedIds.some((id) => typeof id !== "string") ||
      typeof run.answer !== "string" ||
      typeof run.label !== "string" ||
      (run.stageId !== null && !/^S[1-7]$/.test(run.stageId)) ||
      (run.recordingPath !== null && typeof run.recordingPath !== "string")
    )
      throw new Error("练习恢复记录损坏，已停止写入。");
  }
  if (
    s.pendingDeletions.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id),
    )
  )
    throw new Error("删除恢复记录损坏，已停止写入。");
  for (const event of s.events) {
    if (
      !event ||
      !["attempt", "review", "exposure"].includes(event.type) ||
      !ids.has(event.learnerId) ||
      typeof event.id !== "string" ||
      !Number.isFinite(Date.parse(event.at))
    )
      throw new Error("学习事件损坏，已停止写入。");
    if (event.type === "attempt") {
      const a = event.attempt;
      if (
        !a ||
        a.learnerId !== event.learnerId ||
        !validText(a.id) ||
        !validText(a.clientEventId) ||
        !validText(a.sessionId) ||
        !exerciseIds.has(a.exerciseId) ||
        typeof a.answer !== "string" ||
        !Array.isArray(a.selectedIds) ||
        a.selectedIds.some((id) => typeof id !== "string") ||
        !validGrade(a.grade) ||
        !validTime(a.submittedAt) ||
        ![0, 1, 3].includes(a.hintLevel) ||
        !["normal", "suspect"].includes(a.clockStatus) ||
        typeof a.firstTest !== "boolean" ||
        typeof a.localDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(a.localDate) ||
        typeof a.timezone !== "string" ||
        (a.recordingPath !== null && typeof a.recordingPath !== "string")
      )
        throw new Error("答题记录损坏，已停止写入。");
    }
    if (
      event.type === "exposure" &&
      (!Array.isArray(event.targets) ||
        event.targets.some((target) => !validCell(target)))
    )
      throw new Error("提示记录损坏，已停止写入。");
    if (
      event.type === "review" &&
      (!validText(event.attemptId) ||
        typeof event.passed !== "boolean" ||
        !Number.isSafeInteger(event.expectedRevision) ||
        event.expectedRevision < 0)
    )
      throw new Error("复核记录损坏，已停止写入。");
  }
  return s;
}
const KEY = "lingonest.local.v1";
export class LocalRepository {
  private revision = 0;
  private loaded = false;
  async load(): Promise<LocalState> {
    const result = isAndroid ? await native.loadState() : await this.webRead();
    const state =
      result.payload === null ? emptyState() : decodeState(result.payload);
    this.revision = result.revision;
    this.loaded = true;
    return state;
  }
  private async webRead(): Promise<{
    revision: number;
    payload: string | null;
  }> {
    const data = localStorage.getItem(KEY);
    if (data === null) return { revision: 0, payload: null };
    const result = JSON.parse(data);
    if (
      !Number.isSafeInteger(result.revision) ||
      typeof result.payload !== "string"
    )
      throw new Error("浏览器预览数据损坏。");
    return result;
  }
  async save(state: LocalState): Promise<void> {
    if (!this.loaded) throw new Error("数据尚未加载，不能写入。");
    const payload = JSON.stringify(state);
    decodeState(payload);
    if (new TextEncoder().encode(payload).byteLength > 10 * 1024 * 1024)
      throw new Error("学习记录已达到此预览版容量上限。");
    if (isAndroid) {
      const result = await native.saveState({
        expectedRevision: this.revision,
        payload,
      });
      this.revision = result.revision;
    } else {
      const write = async () => {
        const current = await this.webRead();
        if (current.revision !== this.revision)
          throw new Error("另一个页面已更新记录，请刷新后重试。");
        const next = this.revision + 1;
        localStorage.setItem(KEY, JSON.stringify({ revision: next, payload }));
        this.revision = next;
      };
      if (navigator.locks) await navigator.locks.request(KEY, write);
      else await write();
    }
  }
}
