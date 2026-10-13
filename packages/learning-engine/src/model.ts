export type StageId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
export type ExerciseKind =
  | "choice"
  | "spelling"
  | "sentence"
  | "order"
  | "oral";
export type Ability =
  | "meaning"
  | "spelling"
  | "usage"
  | "readAloud"
  | "recall"
  | "dictation"
  | "transfer";
export interface CellRef {
  knowledgeId: string;
  ability: Ability;
  mode: "recognition" | "written" | "oral";
}
export interface Exercise {
  id: string;
  stageId: StageId;
  kind: ExerciseKind;
  familyId: string;
  title: string;
  prompt: string;
  instruction: string;
  hint: string;
  acceptedAnswers: string[];
  options?: { id: string; text: string }[];
  correctOptionIds?: string[];
  tokens?: { id: string; text: string }[];
  correctTokenIds?: string[];
  target: CellRef;
  criticalTokens?: string[];
  threshold: number;
  speakText?: string;
  referenceText?: string;
  exposureTargets?: CellRef[];
}
export interface GradeResult {
  status: "scored" | "needs_review" | "unscorable";
  score: number | null;
  passed: boolean | null;
  source: "local" | "human";
  feedback: string;
  normalizedAnswer: string;
  policyVersion: "2";
}
export interface Attempt {
  id: string;
  clientEventId: string;
  learnerId: string;
  sessionId: string;
  exerciseId: string;
  answer: string;
  selectedIds: string[];
  recordingPath: string | null;
  hintLevel: 0 | 1 | 3;
  submittedAt: string;
  localDate: string;
  timezone: string;
  clockStatus: "normal" | "suspect";
  firstTest: boolean;
  grade: GradeResult;
}
export type LearningEvent =
  | {
      id: string;
      type: "attempt";
      learnerId: string;
      at: string;
      attempt: Attempt;
    }
  | {
      id: string;
      type: "review";
      learnerId: string;
      at: string;
      attemptId: string;
      passed: boolean;
      expectedRevision: number;
    }
  | {
      id: string;
      type: "exposure";
      learnerId: string;
      at: string;
      targets: CellRef[];
    };
export interface SkillState extends CellRef {
  key: string;
  alpha: number;
  beta: number;
  mastery: number;
  evidenceCount: number;
  effectiveWeight: number;
  status: "unmeasured" | "learning" | "mastered" | "review_due";
  latestPassed: boolean | null;
  dueAt: string | null;
  eligibleAt: string | null;
  reviewLevel: number;
  delayedPass: boolean;
}
export interface EvaluatedAttempt extends Attempt {
  reviewRevision: number;
}
export interface Projection {
  attempts: EvaluatedAttempt[];
  skills: SkillState[];
}
