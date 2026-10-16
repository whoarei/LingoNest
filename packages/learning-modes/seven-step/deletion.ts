import type { CourseRecord } from "./authoring";
import type { LocalState } from "./state";
import type { LearningEvent } from "./model";
export interface CourseDeletion {
  record: CourseRecord;
  recordings: string[];
  images: string[];
}
/** Reversible deletion retains exercises, events, recordings and resources. */
export function archiveCourse(state: LocalState, id: string) {
  const record = state.courses.find(
    (item) => item.id === id && !item.deletedAt,
  );
  if (!record) throw new Error("只能删除课程列表中的自建课程。");
  record.deletedAt = new Date().toISOString();
  for (const [learnerId, courseId] of Object.entries(state.learningCourseIds))
    if (courseId === id) delete state.learningCourseIds[learnerId];
}
export function restoreCourse(state: LocalState, id: string) {
  const record = state.courses.find((item) => item.id === id && item.deletedAt);
  if (!record) throw new Error("课程不在已删除列表中。");
  if (state.courses.filter((item) => !item.deletedAt).length >= 30)
    throw new Error("课程列表已满，请先移走一门课程再恢复。");
  delete record.deletedAt;
}
export function purgeCourse(state: LocalState, id: string): CourseDeletion {
  if (!state.courses.some((item) => item.id === id && item.deletedAt))
    throw new Error("只能彻底删除已删除列表中的课程。");
  return removeCourse(state, id);
}
/** Remove all references together before cleaning private files; leave other courses intact. */
export function removeCourse(state: LocalState, id: string): CourseDeletion {
  const record = state.courses.find((item) => item.id === id);
  if (!record) throw new Error("只能删除自建课程，内置课程保留。");
  const exerciseIds = new Set(
    record.package?.exercises.map((item) => item.id) ?? [],
  );
  const knowledgeIds = new Set(
    record.package?.exercises.map((item) => item.target.knowledgeId) ?? [],
  );
  const removedAttempts = new Set<string>();
  const recordings = new Set<string>();
  for (const event of state.events) {
    if (event.type === "attempt" && exerciseIds.has(event.attempt.exerciseId)) {
      removedAttempts.add(event.attempt.id);
      if (event.attempt.recordingPath)
        recordings.add(event.attempt.recordingPath);
    }
  }
  for (const run of state.runs)
    if (run.courseId === id && run.recordingPath)
      recordings.add(run.recordingPath);
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
  for (const [learnerId, courseId] of Object.entries(state.learningCourseIds))
    if (courseId === id) delete state.learningCourseIds[learnerId];
  const retainedRecordings = new Set(
    state.events.flatMap((event) =>
      event.type === "attempt" && event.attempt.recordingPath
        ? [event.attempt.recordingPath]
        : [],
    ),
  );
  state.runs.forEach((run) => {
    if (run.recordingPath) retainedRecordings.add(run.recordingPath);
  });
  const retainedImages = new Set(
    state.courses.flatMap((item) =>
      [...item.images, ...item.vocabularyImages].map((image) => image.path),
    ),
  );
  const deletion = {
    record,
    recordings: [...recordings].filter((path) => !retainedRecordings.has(path)),
    images: [
      ...new Set(
        [...record.images, ...record.vocabularyImages].map(
          (image) => image.path,
        ),
      ),
    ].filter((path) => !retainedImages.has(path)),
  };
  state.pendingCourseDeletions.push(deletion);
  return deletion;
}
