import type { PassageState } from "./model";
import { packageFor } from "./references";
import { projectGoalProgress } from "./progress";

export function passageReport(state: PassageState, learnerId: string, courseId: string, revision: string) {
  const pkg = packageFor(state, courseId, revision);
  const attempts = state.attempts.filter(attempt => attempt.learnerId === learnerId && attempt.item.courseId === courseId && attempt.item.revision === revision);
  const firstAttempts = attempts.filter(attempt => attempt.item.reason !== "repair");
  return {
    completedLevels: state.completions.filter(item => item.learnerId === learnerId && item.courseId === courseId && item.revision === revision).length,
    totalLevels: pkg.levels.length,
    firstAttemptCount: firstAttempts.length,
    firstCorrectCount: firstAttempts.filter(attempt => attempt.correct).length,
    assistedAttemptCount: attempts.filter(attempt => attempt.assisted).length,
    repairAttemptCount: attempts.length - firstAttempts.length,
    goals: projectGoalProgress(state, learnerId, pkg),
  };
}
