import type { PassageState } from "./model";
import { copy } from "./validation";

export function removePassageLearner(state: PassageState, learnerId: string): PassageState {
  const next = copy(state);
  next.sessions = next.sessions.filter(session => session.learnerId !== learnerId);
  next.attempts = next.attempts.filter(attempt => attempt.learnerId !== learnerId);
  next.completions = next.completions.filter(item => item.learnerId !== learnerId);
  return next;
}
/** Removes the deleted source while retaining other courses' facts and completions. */
export function removePassageCourse(state: PassageState, courseId: string): PassageState {
  const next = copy(state);
  if (next.candidates) next.candidates = next.candidates.filter(item => item.package.courseId !== courseId);
  const removedSessions = new Set(next.sessions.filter(session => session.courseId === courseId).map(session => session.id));
  next.sessions = next.sessions.filter(session => !removedSessions.has(session.id));
  next.attempts = next.attempts.filter(attempt => !removedSessions.has(attempt.sessionId) && attempt.item.courseId !== courseId);
  next.completions = next.completions.filter(item => item.courseId !== courseId && !removedSessions.has(item.sessionId));
  for (const session of next.sessions) {
    if (!session.queue.some(item => item.courseId === courseId)) continue;
    const oldQueue = session.queue, oldIndex = session.index, oldBase = session.baseCount;
    const positions = new Map<number, number>();
    const kept = oldQueue.filter((item, index) => {
      if (item.courseId === courseId) return false;
      positions.set(index, positions.size); return true;
    });
    const removedBase = oldQueue.slice(0, oldBase).filter(item => item.courseId === courseId).length;
    session.queue = kept;
    session.index = oldQueue.slice(0, oldIndex).filter(item => item.courseId !== courseId).length;
    session.baseCount = oldBase - removedBase;
    session.purgedBaseCount = (session.purgedBaseCount ?? 0) + removedBase;
    session.purgedQuestionCount = (session.purgedQuestionCount ?? 0) + oldQueue.length - kept.length;
    session.purgedCourseIds = [...new Set([...(session.purgedCourseIds ?? []), courseId])];
    session.assistedGoals = session.assistedGoals.filter(goal => goal.courseId !== courseId);
    if (oldQueue[oldIndex]?.courseId === courseId) { session.input = { text: "", selectedIds: [] }; session.feedbackAttemptId = null; }
    if (session.status === "active") session.status = "retired";
    for (const attempt of next.attempts.filter(attempt => attempt.sessionId === session.id)) attempt.index = positions.get(attempt.index)!;
  }
  next.packages = next.packages.filter(pkg => pkg.courseId !== courseId);
  next.publications = next.publications.filter(item => item.courseId !== courseId);
  return next;
}
