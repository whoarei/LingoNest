import type { Ref, ComputedRef } from "vue";
import type { SpeechController } from "./useSpeech";
import type {
  Exercise,
  StageId,
  EvaluatedAttempt,
  SkillState,
  GradeResult,
} from "../packages/learning-engine/src/model";
export interface Learner {
  id: string;
  nickname: string;
  createdAt: string;
}
export interface DialogueTurn {
  id: string;
  block: "A" | "B" | "C";
  speaker: string;
  text: string;
  translation: string;
}
export interface StageView {
  id: StageId;
  title: string;
  subtitle: string;
  icon: string;
  total: number;
  done: number;
  available: boolean;
  verified: boolean;
}
export interface Course {
  id: string;
  version: string;
  title: string;
  subtitle: string;
  description: string;
  turns: DialogueTurn[];
}
export interface HistoryItem extends EvaluatedAttempt {
  exercise: Exercise;
}
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
  course: Course;
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
  skills: ComputedRef<SkillState[]>;
  storageLabel: string;
  addLearner(name: string): Promise<void>;
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
  playRecording(path: string): Promise<void>;
  reviewAttempt(id: string, passed: boolean): Promise<void>;
  deleteLearner(): Promise<void>;
  dismissError(): void;
}
