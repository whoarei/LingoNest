import type { SourceImage } from "../contracts";
/** All teaching structures in this file belong to passage-path, not the host. */
export interface PassageSource {
  courseId: string;
  revision: string;
  title: string;
  images?: SourceImage[];
  turns: { id: string; speaker: string; text: string }[];
}
export interface KnowledgeChunk {
  id: string;
  title: string;
  expression: string;
  meaning: string;
  sourceTurnIds: string[];
}
export interface LearningGoal {
  id: string;
  chunkId: string;
  title: string;
  skill: "meaning" | "listening" | "expression";
  requiresRecall: boolean;
}
export type Demand = "recognize" | "supported" | "recall";
interface QuestionBase {
  id: string;
  goalId: string;
  prompt: string;
  explanation: string;
  sourceTurnIds: string[];
  audioText: string | null;
}
export type PassageQuestion = QuestionBase & (
  | { kind: "choice" | "listen-choice" | "dialogue-choice"; demand: "recognize";
      options: { id: string; text: string }[]; correctOptionId: string }
  | { kind: "order"; demand: "supported"; tokens: { id: string; text: string }[]; correctTokenIds: string[] }
  | { kind: "cloze"; demand: "recall"; answers: string[] }
);
export interface PassageLevel {
  id: string;
  title: string;
  newGoalIds: string[];
  reviewGoalIds: string[];
}
export interface PassageDraft {
  chunks: KnowledgeChunk[];
  goals: LearningGoal[];
  levels: PassageLevel[];
  questions: PassageQuestion[];
}
export interface PassageRules {
  version: "1";
  questionCount: number;
  minQuestionCount: number;
  maxNewChunks: number;
  dueCount: number;
  weakCount: number;
  maxCrossCourse: number;
  maxRepairs: number;
}
export interface PassagePackage extends PassageDraft {
  schemaVersion: 1;
  modeId: "passage-path";
  runtimeVersion: "1";
  gradingVersion: "1";
  courseId: string;
  modeInstanceId: string;
  revision: string;
  source: PassageSource;
  provenance: { model: string; promptVersion: "1"; compilerVersion: "1"; generatedAt: string };
  rules: PassageRules;
}
export interface Publication {
  courseId: string;
  revision: string;
  reviewedAt: string;
  audioAssetIds: string[];
}
/** Parent-only candidate bank. Published packages and learning facts remain immutable. */
export interface PassageReview {
  package: PassagePackage;
  reviewedQuestionIds: string[];
  sourceConfirmed: boolean;
}
export type SelectionReason = "current" | "due" | "weak" | "repair";
export interface SessionItem {
  courseId: string;
  revision: string;
  questionId: string;
  reason: SelectionReason;
  displayIds: string[];
}
export interface PassageResponse { text: string; selectedIds: string[] }
export interface PassageSession {
  id: string;
  learnerId: string;
  courseId: string;
  revision: string;
  levelId: string | null;
  kind: "path" | "replay" | "practice";
  status: "active" | "completed" | "retired";
  seed: number;
  schedulerVersion: "1";
  startedAt: string;
  baseline: boolean;
  queue: SessionItem[];
  baseCount: number;
  index: number;
  input: PassageResponse;
  assistedGoals: { courseId: string; revision: string; goalId: string }[];
  feedbackAttemptId: string | null;
  /** Durable removal keeps other courses' facts and completed path positions. */
  purgedCourseIds?: string[];
  purgedQuestionCount?: number;
  purgedBaseCount?: number;
}
export interface PassageAttempt {
  id: string;
  sessionId: string;
  index: number;
  learnerId: string;
  item: SessionItem;
  response: PassageResponse;
  correct: boolean;
  assisted: boolean;
  clockTrusted: boolean;
  evidenceEligible: boolean;
  gradingVersion: "1";
  at: string;
}
export interface LevelCompletion {
  learnerId: string;
  courseId: string;
  revision: string;
  levelId: string;
  sessionId: string;
}
export interface PassageState {
  formatVersion: 1;
  candidates?: PassageReview[];
  packages: PassagePackage[];
  publications: Publication[];
  sessions: PassageSession[];
  attempts: PassageAttempt[];
  completions: LevelCompletion[];
  lastObservedAt: string | null;
}
export interface RuntimeContext {
  activeModeId: string;
  learnerId: string;
  courseId: string;
  courses: { courseId: string; available: boolean; audioReady: boolean }[];
  /** Device clock monitoring is supplied by the caller; rollback is also checked locally. */
  clock: { at: string; trusted: boolean };
}
export interface GoalProgress {
  goalId: string;
  seen: boolean;
  weak: boolean;
  independentSessions: number;
  lastEvidenceAt: string | null;
  dueAt: string | null;
  status: "unseen" | "practicing" | "weak" | "stable";
}
