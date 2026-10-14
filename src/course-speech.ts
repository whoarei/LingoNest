import { course, exercises } from "./course";
import type { CourseAudioSpec } from "./speech-types";

import type { Course } from "./domain";
import type { Exercise } from "../packages/learning-engine/src/model";
export function makeCourseAudioSpec(
  course: Course,
  exercises: Exercise[],
): CourseAudioSpec {
  const seen = new Set<string>();
  const assets: CourseAudioSpec["assets"] = [];
  function add(id: string, value: string) {
    const text = value.trim().normalize("NFC");
    if (seen.has(text)) return;
    seen.add(text);
    assets.push({ id, text });
  }
  course.turns.forEach((turn) => add(`turn-${turn.id}`, turn.text));
  exercises.forEach((exercise) => {
    if (exercise.speakText) add(`exercise-${exercise.id}`, exercise.speakText);
  });
  return {
    courseId: course.id,
    courseVersion: course.version,
    title: course.title,
    assets,
  };
}
export const courseAudioSpec = makeCourseAudioSpec(course, exercises);
