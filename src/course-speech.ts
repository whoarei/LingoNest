import { course, exercises } from "./course";
import type { CourseAudioSpec } from "./speech-types";

// One asset per exact spoken text; the same sentence can serve dialogue and dictation.
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
export const courseAudioSpec: CourseAudioSpec = {
  courseId: course.id,
  courseVersion: course.version,
  title: course.title,
  assets,
};
