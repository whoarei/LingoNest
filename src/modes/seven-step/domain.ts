import type { Ref, ComputedRef } from "vue";
import type { SpeechController } from "../../platform/speech";
import type { CourseRecord, SourceImage } from "../../../packages/learning-modes/seven-step/authoring";
import type {
  Exercise,
  StageId,
  EvaluatedAttempt,
  SkillState,
  GradeResult,
  LearningEvent,
} from "../../../packages/learning-modes/seven-step/model";
import type { Learner, Course, StageView, HistoryItem } from "../../../packages/learning-modes/seven-step/model";
export type { Learner, Course, DialogueTurn, StageView, HistoryItem } from "../../../packages/learning-modes/seven-step/model";
export interface LearningUI {
  speech: SpeechController;
  ready: Ref<boolean>;
  busy: Ref<boolean>;
  error: Ref<string>;
  notice: Ref<string>;
  view: Ref<
    | "home"
    | "lesson"
    | "practice"
    | "review"
    | "progress"
    | "settings"
    | "parent"
  >;
  learners: Ref<Learner[]>;
  learner: ComputedRef<Learner | null>;
  course: ComputedRef<Course>;
  courses: ComputedRef<CourseRecord[]>;
  deletedCourses: ComputedRef<CourseRecord[]>;
  exercises: ComputedRef<Exercise[]>;
  sourceImages: ComputedRef<SourceImage[]>;
  saveCourse(record: CourseRecord): Promise<boolean>;
  assignCourse(id: string): Promise<boolean>;
  deleteCourse(id: string): Promise<boolean>;
  restoreCourse(id: string): Promise<boolean>;
  purgeCourse(id: string): Promise<boolean>;
  retryCourseCleanup(): Promise<void>;
  pendingCourseCleanupCount: ComputedRef<number>;
  confirmed: ComputedRef<boolean>;
  stages: ComputedRef<StageView[]>;
  currentExercise: ComputedRef<Exercise | null>;
  answer: Ref<string>;
  selectedIds: Ref<string[]>;
  hintShown: Ref<boolean>;
  feedback: Ref<GradeResult | null>;
  recording: Ref<boolean>;
  recordingPath: Ref<string | null>;
  practice: ComputedRef<{
    position: number;
    total: number;
    label: string;
    finished: boolean;
  }>;
  stats: ComputedRef<{
    todayAttempts: number;
    pendingReviews: number;
    dueCount: number;
    measured: number;
    mastered: number;
    completedStages: number;
  }>;
  history: ComputedRef<HistoryItem[]>;
  pending: ComputedRef<HistoryItem[]>;
  reviewLog: ComputedRef<Extract<LearningEvent, { type: "review" }>[]>;
  skills: ComputedRef<SkillState[]>;
  storageLabel: string;
  addLearner(name: string): Promise<void>;
  renameLearner(name: string): Promise<void>;
  selectLearner(id: string): Promise<void>;
  confirmCourse(): Promise<void>;
  startStage(id: StageId): void;
  startReview(): void;
  openLesson(): Promise<void>;
  submit(): Promise<void>;
  next(): void;
  revealHint(): Promise<void>;
  revealReference(): Promise<void>;
  speak(text: string): Promise<void>;
  stopSpeech(): Promise<void>;
  toggleRecording(): Promise<void>;
  playRecording(path: string): Promise<boolean>;
  stopPlayback(): Promise<void>;
  reviewAttempt(
    id: string,
    passed: boolean,
    expectedRevision?: number,
  ): Promise<void>;
  refreshLearning(): void;
  deleteLearner(): Promise<void>;
  dismissError(): void;
}
