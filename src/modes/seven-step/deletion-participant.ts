import type { DeletionParticipant, DeletionTarget, OwnedResource } from "../../platform/deletions";
import type { SharedSnapshot } from "../../platform/shared-snapshot";
import type { LocalState } from "../../../packages/learning-modes/seven-step/state";
import { removeCourse } from "../../../packages/learning-modes/seven-step/deletion";
import { makeCourseAudioSpec } from "../../../packages/learning-modes/seven-step/audio";
import type { CourseRecord } from "../../../packages/learning-modes/seven-step/authoring";

function recordResources(record: CourseRecord): OwnedResource[] {
  const resources: OwnedResource[] = [...record.images, ...record.vocabularyImages].filter(image => image.path.startsWith("course-images/"))
    .map(image => ({ kind: "image", path: image.path }));
  if (record.package) resources.push({ kind: "audio", course: makeCourseAudioSpec(record.package.course, record.package.exercises) });
  return resources;
}
function recordings(state: LocalState, matches: (learnerId: string, exerciseId: string) => boolean, runMatches: (learnerId: string, courseId: string) => boolean): OwnedResource[] {
  return [
    ...state.events.flatMap(event => event.type === "attempt" && event.attempt.recordingPath && matches(event.learnerId, event.attempt.exerciseId)
      ? [{ kind: "recording" as const, path: event.attempt.recordingPath }] : []),
    ...state.runs.flatMap(run => run.recordingPath && runMatches(run.learnerId, run.courseId) ? [{ kind: "recording" as const, path: run.recordingPath }] : []),
  ];
}
export function sevenStepDeletionParticipant(store: SharedSnapshot<LocalState>): DeletionParticipant {
  return {
    id: "seven-step",
    async prepare(target) {
      const state = await store.refresh();
      if (target.kind === "learner") {
        return [{ kind: "learner-recordings", learnerId: target.id }, ...recordings(state, id => id === target.id, id => id === target.id)];
      }
      const record = state.courses.find(item => item.id === target.id);
      const exerciseIds = new Set(record?.package?.exercises.map(item => item.id) ?? []);
      return [...(record ? recordResources(record) : []), ...recordings(state, (_, exerciseId) => exerciseIds.has(exerciseId), (_, courseId) => courseId === target.id)];
    },
    async remove(target: DeletionTarget) {
      await store.update(state => {
        if (target.kind === "course") {
          removeCourse(state, target.id);
        } else {
          state.events = state.events.filter(event => event.learnerId !== target.id);
          state.runs = state.runs.filter(run => run.learnerId !== target.id);
          state.confirmedCourses = state.confirmedCourses.filter(item => item.learnerId !== target.id);
        }
      });
    },
    async retained() {
      const state = await store.refresh();
      return [...state.courses.flatMap(recordResources),
        ...recordings(state, () => true, () => true)];
    },
  };
}
