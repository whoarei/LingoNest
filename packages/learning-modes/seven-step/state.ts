import type { SnapshotCodec } from "../contracts";
import type {
  LearningEvent,
  StageId,
  CellRef,
  GradeResult,
} from "./model";
import { exercises as starterExercises } from "./course";
import {
  starterRecord,
  validateCourseRecord,
  type CourseRecord,
} from "./authoring";

/** Teaching payload only; shared identities and selection belong to the catalog. */
export interface LocalState {
  formatVersion: 1;
  events: LearningEvent[];
  lastObservedAt: string | null;
  runs: PracticeRun[];
  courses: CourseRecord[];
  confirmedCourses: { learnerId: string; courseId: string; version: string }[];
}
export interface PracticeRun {
  id: string;
  learnerId: string;
  courseId: string;
  stageId: StageId | null;
  exerciseIds: string[];
  index: number;
  label: string;
  hints: Record<string, 0 | 1 | 3>;
  answer: string;
  selectedIds: string[];
  recordingPath: string | null;
  purpose?: "independent";
}
export const emptyState = (): LocalState => ({
  formatVersion: 1,
  events: [],
  lastObservedAt: null,
  runs: [],
  courses: [],
  confirmedCourses: [],
});
const validText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const validTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
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
  if (!s || s.formatVersion !== 1 || !Array.isArray(s.courses) || s.courses.length > 300 ||
    !Array.isArray(s.events) || !Array.isArray(s.runs) || !Array.isArray(s.confirmedCourses) ||
    Object.keys(s).some(key => !["formatVersion", "courses", "events", "runs", "confirmedCourses", "lastObservedAt"].includes(key)))
    throw Error("七步数据格式不受支持，已停止写入。");
  s.courses.forEach(validateCourseRecord);
  if (s.courses.some(record => record.deletedAt !== undefined)) throw Error("七步内容不能保存公共归档状态。");
  if (new Set(s.courses.map((record) => record.id)).size !== s.courses.length)
    throw new Error("课程标识重复。");
  const packages = [
    starterRecord.package!,
    ...s.courses
      .filter((record) => record.status === "published")
      .map((record) => record.package!),
  ];
  const courseIds = new Set(packages.map((item) => item.course.id));
  const exercises = [
    ...starterExercises,
    ...packages.slice(1).flatMap((item) => item.exercises),
  ];
  const exerciseIds = new Set(exercises.map((item) => item.id));
  if (exerciseIds.size !== exercises.length) throw new Error("练习标识重复。");
  if (s.lastObservedAt !== null && !validTime(s.lastObservedAt))
    throw new Error("时间记录损坏，已停止写入。");
  if (s.confirmedCourses.some(item => !item || !validText(item.learnerId) ||
    !packages.some(pack => pack.course.id === item.courseId && pack.course.version === item.version)))
    throw Error("学习课程引用无效，已停止写入。");
  for (const run of s.runs) {
    if (
      !run ||
      !validText(run.id) ||
      !validText(run.learnerId) ||
      !courseIds.has(run.courseId) ||
      !Array.isArray(run.exerciseIds) ||
      run.exerciseIds.some((id) => !exerciseIds.has(id)) ||
      run.exerciseIds.some(
        (id) =>
          !packages
            .find((pack) => pack.course.id === run.courseId)!
            .exercises.some((exercise) => exercise.id === id),
      ) ||
      !Number.isInteger(run.index) ||
      run.index < 0 ||
      run.index > run.exerciseIds.length ||
      !run.hints ||
      Object.values(run.hints).some((level) => ![0, 1, 3].includes(level)) ||
      !Array.isArray(run.selectedIds) ||
      run.selectedIds.some((id) => typeof id !== "string") ||
      typeof run.answer !== "string" ||
      typeof run.label !== "string" ||
      (run.purpose !== undefined && run.purpose !== "independent") ||
      (run.stageId !== null && !/^S[1-7]$/.test(run.stageId)) ||
      (run.recordingPath !== null && typeof run.recordingPath !== "string")
    )
      throw new Error("练习恢复记录损坏，已停止写入。");
  }
  for (const event of s.events) {
    if (
      !event ||
      !["attempt", "review", "exposure"].includes(event.type) ||
      !validText(event.learnerId) ||
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

export const sevenStepStateCodec: SnapshotCodec<LocalState> = {
  storageKey: "lingonest.seven-step.v1",
  empty: emptyState,
  decode: decodeState,
};
