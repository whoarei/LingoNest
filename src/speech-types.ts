import type { CourseAudioManifest } from "../packages/learning-modes/contracts";

export type SpeechProtocol = "openai-speech" | "mimo-chat";
export interface SpeechConfiguration {
  mode: "device" | "ai";
  protocol: SpeechProtocol;
  baseUrl: string;
  model: string;
  voice: string;
  speed: number;
  instructions: string;
  hasKey: boolean;
}
export type SpeechInput = Omit<SpeechConfiguration, "hasKey"> & {
  apiKey?: string;
};
export interface SpeechStatus {
  phase: "idle" | "generating" | "playing";
  source?: "device" | "ai" | "course";
  cached?: boolean;
}
export type CourseAudioSpec = CourseAudioManifest;
export interface CourseAudioStatus {
  total: number;
  ready: number;
  bytes: number;
  complete: boolean;
  voice: string;
  model: string;
  matchesSettings: boolean;
  pending: { ready: number; total: number; voice: string } | null;
}
export interface CourseAudioProgress {
  generating: boolean;
  completed: number;
  total: number;
}
export const emptyCourseAudioStatus = (total: number): CourseAudioStatus => ({
  total,
  ready: 0,
  bytes: 0,
  complete: false,
  voice: "",
  model: "",
  matchesSettings: false,
  pending: null,
});
export const defaultSpeechConfiguration = (): SpeechConfiguration => ({
  mode: "device",
  protocol: "openai-speech",
  baseUrl: "",
  model: "",
  voice: "alloy",
  speed: 0.9,
  instructions: "",
  hasKey: false,
});
export const speechVoices = {
  "mimo-chat": [
    { id: "Chloe", label: "Chloe · 英语女声" },
    { id: "Mia", label: "Mia · 英语女声" },
    { id: "Milo", label: "Milo · 英语男声" },
    { id: "Dean", label: "Dean · 英语男声" },
  ],
  "openai-speech": [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "onyx",
    "nova",
    "sage",
    "shimmer",
    "verse",
    "marin",
    "cedar",
  ].map((id) => ({ id, label: id })),
};
export const speechSample = "My favorite sport is ping-pong. Will you join us?";
