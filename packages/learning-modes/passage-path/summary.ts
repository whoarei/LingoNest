import type { PassagePackage, PassageSession, PassageState } from "./model";
import { packageFor, questionFor, referenceKey } from "./references";
import { completedLessons, hasCurriculum } from "./curriculum";
import { projectGoalProgress } from "./progress";

export function roundSummary(state: PassageState, session: PassageSession) {
  const attempts = state.attempts.filter(attempt => attempt.sessionId === session.id);
  const written = attempts.filter(attempt => attempt.correct !== null && attempt.item.reason !== "repair");
  const goals = new Map<string, { courseId: string; title: string; needsPractice: boolean }>();
  for (const attempt of attempts) {
    const pkg = packageFor(state, attempt.item.courseId, attempt.item.revision), question = questionFor(state, attempt.item);
    const goal = pkg.goals.find(goal => goal.id === question.goalId)!;
    const key = referenceKey(pkg.courseId, pkg.revision, goal.id);
    const previous = goals.get(key);
    goals.set(key, { courseId: pkg.courseId, title: goal.title, needsPractice: previous?.needsPractice === true || attempt.correct === false || attempt.response.oral?.selfRating === "again" });
  }
  return { writtenCount: written.length, writtenCorrect: written.filter(attempt => attempt.correct === true).length,
    oralCount: attempts.filter(attempt => attempt.correct === null).length,
    purposes: [...goals.values()].map(goal => goal.title), needsPractice: [...goals.values()].filter(goal => goal.needsPractice).slice(0, 2),
    suggestRepeat: session.kind === "path" && [...goals.values()].some(goal => goal.courseId === session.courseId && goal.needsPractice) };
}

/** Offer an available review lesson after a real interval, without a repetition loop. */
export function reviewSuggestion(state: PassageState, learnerId: string, pkg: PassagePackage, at: string) {
  const now = Date.parse(at);
  if (!hasCurriculum(pkg) || !Number.isFinite(now) || state.lastObservedAt && Date.parse(state.lastObservedAt) > now) return null;
  const goals = projectGoalProgress(state, learnerId, pkg).filter(goal => goal.seen && goal.dueAt && Date.parse(goal.dueAt) <= now)
    .sort((a, b) => Number(b.weak) - Number(a.weak) || Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  for (const goal of goals) {
    const attempts = state.attempts.filter(attempt => attempt.learnerId === learnerId && attempt.item.courseId === pkg.courseId &&
      attempt.item.revision === pkg.revision && questionFor(state, attempt.item).goalId === goal.goalId);
    const latest = Math.max(...attempts.map(attempt => Date.parse(attempt.at)));
    if (now - latest < 24 * 3_600_000) continue;
    const level = pkg.levels.find(level => level.newGoalIds.includes(goal.goalId))!;
    const done = completedLessons(state, learnerId, pkg, level.id);
    if (!done.length) continue;
    return { levelId: level.id, lesson: done.includes("transfer") ? "transfer" as const : "discover" as const,
      goal: pkg.goals.find(item => item.id === goal.goalId)!.title };
  }
  return null;
}
