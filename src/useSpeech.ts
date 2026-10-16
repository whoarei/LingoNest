import type { Ref } from "vue";
import type { CourseAudioSpec, SpeechConfiguration } from "./speech-types";
import { useSpeech as usePlatformSpeech } from "./platform/speech";
import { courseAudioSpec } from "../packages/learning-modes/seven-step/audio";
export type { SpeechController } from "./platform/speech";
// Preserve the old default for developer tools and callers outside the mode.
export function useSpeech(source: CourseAudioSpec | Ref<CourseAudioSpec> = courseAudioSpec, configuration?: Ref<SpeechConfiguration>) {
  return usePlatformSpeech(source, configuration);
}
