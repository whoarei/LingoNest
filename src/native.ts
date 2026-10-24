import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import type {
  SpeechConfiguration,
  SpeechInput,
  SpeechStatus,
  CourseAudioSpec,
  CourseAudioStatus,
  CourseAudioProgress,
} from "./speech-types";
export interface LingoNativeAPI {
  loadDocument(options: { key: string }): Promise<{ revision: number; payload: string | null }>;
  saveDocument(options: { key: string; expectedRevision: number; payload: string }): Promise<{ revision: number }>;
  loadState(): Promise<{ revision: number; payload: string | null }>;
  saveState(options: {
    expectedRevision: number;
    payload: string;
  }): Promise<{ revision: number }>;
  speak(options: {
    text: string;
  }): Promise<{ cached?: boolean; source?: "ai" | "device" } | void>;
  getSpeechConfig(): Promise<SpeechConfiguration>;
  setSpeechConfig(options: SpeechInput): Promise<SpeechConfiguration>;
  clearSpeechConfig(): Promise<SpeechConfiguration>;
  getSpeechCacheInfo(): Promise<{ count: number; bytes: number }>;
  clearSpeechCache(): Promise<void>;
  getCourseAudio(options: {
    course: CourseAudioSpec;
  }): Promise<CourseAudioStatus>;
  generateCourseAudio(options: {
    course: CourseAudioSpec;
  }): Promise<CourseAudioStatus>;
  cancelCourseAudioGeneration(): Promise<void>;
  clearCourseAudio(options: {
    course: CourseAudioSpec;
  }): Promise<CourseAudioStatus>;
  playCourseAudio(options: {
    course: CourseAudioSpec;
    assetId: string;
  }): Promise<{ cached?: boolean; source: "course" | "device" } | void>;
  stopSpeech(): Promise<void>;
  startRecording(options: { learnerId: string }): Promise<void>;
  openAppSettings(): Promise<void>;
  stopRecording(): Promise<{ path: string }>;
  cancelRecording(): Promise<void>;
  playRecording(options: { path: string }): Promise<void>;
  deleteRecordings(options: { learnerId: string }): Promise<void>;
  deleteCourseResources(options: {
    course?: CourseAudioSpec;
    images: string[];
    recordings: string[];
  }): Promise<void>;
  exitApp(): Promise<void>;
  stopAudio(): Promise<void>;
  addListener(
    name: "backButton",
    callback: () => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    name: "recordingStopped",
    callback: (event: { reason: string; learnerId?: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    name: "speechStatus",
    callback: (event: SpeechStatus) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    name: "courseAudioProgress",
    callback: (event: CourseAudioProgress) => void,
  ): Promise<PluginListenerHandle>;
}
export const native = registerPlugin<LingoNativeAPI>("LingoNative");
export const isAndroid = Capacitor.getPlatform() === "android";
