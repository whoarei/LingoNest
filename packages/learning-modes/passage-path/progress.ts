import type { GoalProgress, PassagePackage, PassageState } from "./model";

/** Version 1 is an explainable initial policy, not a fitted memory model. */
export function projectGoalProgress(state: PassageState, learnerId: string, pkg: PassagePackage): GoalProgress[] {
  return pkg.goals.map(goal => {
    let seen = false, weak = false, dueAt: string | null = null, lastEvidenceAt: string | null = null;
    let logicalTime: number | null = null;
    const successes = new Set<string>();
    for (const attempt of state.attempts) {
      if (attempt.learnerId !== learnerId || attempt.item.courseId !== pkg.courseId || attempt.item.revision !== pkg.revision) continue;
      const question = pkg.questions.find(question => question.id === attempt.item.questionId)!;
      if (question.goalId !== goal.id) continue;
      seen = true;
      if (attempt.correct === null) continue;
      if (attempt.clockTrusted) logicalTime = Math.max(logicalTime ?? 0, Date.parse(attempt.at));
      if (!attempt.correct) { weak = true; successes.clear(); }
      if (attempt.correct && attempt.evidenceEligible && !successes.has(attempt.sessionId) &&
        (!lastEvidenceAt || Date.parse(attempt.at) - Date.parse(lastEvidenceAt) >= 24 * 3_600_000)) {
        successes.add(attempt.sessionId);
        lastEvidenceAt = attempt.at;
        weak = false;
      }
      // Feedback can assist later questions in this round. It must not erase a
      // previously qualified interval, unless a subsequent answer is actually wrong.
      if (!attempt.correct || !successes.has(attempt.sessionId)) {
        const hours = weak || attempt.assisted ? 4 : 24;
        dueAt = logicalTime === null ? null : new Date(logicalTime + hours * 3_600_000).toISOString();
      } else if (attempt.evidenceEligible) {
        const hours = [24, 24, 72, 168][Math.min(successes.size, 3)]!;
        dueAt = new Date(logicalTime! + hours * 3_600_000).toISOString();
      }
    }
    return { goalId: goal.id, seen, weak, independentSessions: successes.size, lastEvidenceAt, dueAt,
      status: !seen ? "unseen" : weak ? "weak" : successes.size >= 3 ? "stable" : "practicing" };
  });
}
