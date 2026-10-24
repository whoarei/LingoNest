import type { LocalState } from "./state";
import type { LearningEvent } from "./model";
/** Remove all references together before cleaning private files; leave other courses intact. */
export function removeCourse(state: LocalState, id: string): void {
  const record = state.courses.find((item) => item.id === id);
  if (!record) return;
  const exerciseIds = new Set(
    record.package?.exercises.map((item) => item.id) ?? [],
  );
  const knowledgeIds = new Set(
    record.package?.exercises.map((item) => item.target.knowledgeId) ?? [],
  );
  const removedAttempts = new Set<string>();
  for (const event of state.events) {
    if (event.type === "attempt" && exerciseIds.has(event.attempt.exerciseId)) removedAttempts.add(event.attempt.id);
  }
  state.courses = state.courses.filter((item) => item.id !== id);
  state.runs = state.runs.filter((item) => item.courseId !== id);
  state.events = state.events.flatMap<LearningEvent>((event) => {
    if (event.type === "attempt")
      return exerciseIds.has(event.attempt.exerciseId) ? [] : [event];
    if (event.type === "review")
      return removedAttempts.has(event.attemptId) ? [] : [event];
    const targets = event.targets.filter(
      (target) => !knowledgeIds.has(target.knowledgeId),
    );
    return targets.length ? [{ ...event, targets }] : [];
  });
  state.confirmedCourses = state.confirmedCourses.filter(
    (item) => item.courseId !== id,
  );
}
