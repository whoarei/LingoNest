import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
export interface LingoNativeAPI {
  loadState(): Promise<{ revision: number; payload: string | null }>;
  saveState(options: {
    expectedRevision: number;
    payload: string;
  }): Promise<{ revision: number }>;
  speak(options: { text: string }): Promise<void>;
  stopSpeech(): Promise<void>;
  startRecording(options: { learnerId: string }): Promise<void>;
  stopRecording(): Promise<{ path: string }>;
  cancelRecording(): Promise<void>;
  playRecording(options: { path: string }): Promise<void>;
  deleteRecordings(options: { learnerId: string }): Promise<void>;
  stopAudio(): Promise<void>;
  addListener(
    name: "recordingStopped",
    callback: (event: { reason: string; learnerId?: string }) => void,
  ): Promise<PluginListenerHandle>;
}
export const native = registerPlugin<LingoNativeAPI>("LingoNative");
export const isAndroid = Capacitor.getPlatform() === "android";
