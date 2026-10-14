import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSpeechConfiguration,
  emptyCourseAudioStatus,
  type CourseAudioSpec,
} from "../src/speech-types";
const course: CourseAudioSpec = {
  courseId: "test.course",
  courseVersion: "1",
  title: "Test",
  assets: [{ id: "hello", text: "Hello." }],
};
const mocks = vi.hoisted(() => ({
  getSpeechConfig: vi.fn(),
  getSpeechCacheInfo: vi.fn(),
  setSpeechConfig: vi.fn(),
  clearSpeechConfig: vi.fn(),
  clearSpeechCache: vi.fn(),
  speak: vi.fn(),
  stopSpeech: vi.fn(),
  addListener: vi.fn(),
  getCourseAudio: vi.fn(),
  generateCourseAudio: vi.fn(),
  cancelCourseAudioGeneration: vi.fn(),
  clearCourseAudio: vi.fn(),
  playCourseAudio: vi.fn(),
}));
vi.mock("../src/native", () => ({ isAndroid: true, native: mocks }));
import { useSpeech } from "../src/useSpeech";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSpeechConfig.mockResolvedValue(defaultSpeechConfiguration());
  mocks.getSpeechCacheInfo.mockResolvedValue({ count: 0, bytes: 0 });
  mocks.getCourseAudio.mockResolvedValue(emptyCourseAudioStatus(1));
  mocks.playCourseAudio.mockResolvedValue({ source: "course" });
  mocks.cancelCourseAudioGeneration.mockResolvedValue(undefined);
  mocks.clearSpeechCache.mockResolvedValue(undefined);
  mocks.stopSpeech.mockResolvedValue(undefined);
  mocks.addListener.mockResolvedValue({ remove: vi.fn() });
  mocks.clearSpeechConfig.mockResolvedValue(defaultSpeechConfiguration());
  mocks.setSpeechConfig.mockImplementation(async (input) => {
    const { apiKey, ...publicInput } = input;
    return { ...publicInput, hasKey: !!apiKey };
  });
});
describe("speech controller", () => {
  it("does not start a request when stopped while configuration is still loading", async () => {
    let release!: (
      value: ReturnType<typeof defaultSpeechConfiguration>,
    ) => void;
    mocks.getSpeechConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const speech = useSpeech(course);
    const pending = speech.play("Hello.");
    await speech.stop();
    release(defaultSpeechConfiguration());
    expect(await pending).toBe(false);
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(mocks.playCourseAudio).not.toHaveBeenCalled();
    expect(speech.phase.value).toBe("idle");
  });
  it("loads public settings, saves configuration and never keeps the API key in state", async () => {
    const speech = useSpeech();
    await speech.load();
    await speech.save({
      mode: "ai",
      protocol: "mimo-chat",
      baseUrl: "https://api.example.com/v1",
      model: "test-tts",
      voice: "Chloe",
      speed: 0.75,
      instructions: "",
      apiKey: "fake-key",
    });
    expect(speech.configuration.value.hasKey).toBe(true);
    expect(speech.configuration.value).not.toHaveProperty("apiKey");
    expect(speech.label.value).toContain("待生成");
  });
  it("updates playback/cache status and resets after completion", async () => {
    const speech = useSpeech();
    await speech.load();
    speech.configuration.value.mode = "ai";
    let finish!: (value: { cached: boolean }) => void;
    mocks.speak.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = speech.preview("Hello.");
    await vi.waitFor(() => expect(speech.phase.value).toBe("generating"));
    const listener = mocks.addListener.mock.calls[0]![1];
    listener({ phase: "playing", cached: true });
    expect(speech.lastCached.value).toBe(true);
    finish({ cached: true });
    await pending;
    expect(speech.phase.value).toBe("idle");
  });
  it("stopping prevents a late response from replacing current state", async () => {
    const speech = useSpeech();
    await speech.load();
    let fail!: (error: unknown) => void;
    mocks.speak.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const pending = speech.preview("Hello.");
    await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalled());
    await speech.stop();
    fail({ code: "AUDIO_INTERRUPTED" });
    await pending;
    expect(speech.phase.value).toBe("idle");
  });
  it("surfaces generation errors instead of silently reverting to device TTS", async () => {
    const speech = useSpeech();
    await speech.load();
    mocks.speak.mockRejectedValue(new Error("Unsupported speech model"));
    await expect(speech.preview("Hello.")).rejects.toThrow(
      "Unsupported speech model",
    );
    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(speech.phase.value).toBe("idle");
  });
  it("plays registered course resources without invoking speech synthesis", async () => {
    const speech = useSpeech(course);
    await speech.load();
    await speech.play("Hello.");
    expect(mocks.playCourseAudio).toHaveBeenCalledWith({
      course,
      assetId: "hello",
    });
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(speech.lastSource.value).toBe("course");
    await expect(speech.play("Not in this course.")).rejects.toThrow(
      "资源清单",
    );
  });
  it("preview cache cleanup and removing the key retain installed course audio", async () => {
    mocks.getCourseAudio.mockResolvedValue({
      ...emptyCourseAudioStatus(1),
      ready: 1,
      complete: true,
      voice: "Chloe",
    });
    const speech = useSpeech(course);
    await speech.load();
    await speech.clearCache();
    await speech.reset();
    await speech.play("Hello.");
    expect(speech.courseAudio.value.ready).toBe(1);
    expect(speech.label.value).toContain("课程音频");
    expect(mocks.clearCourseAudio).not.toHaveBeenCalled();
    expect(mocks.speak).not.toHaveBeenCalled();
  });
  it("course playback remains available when encrypted provider settings cannot be read", async () => {
    mocks.getSpeechConfig.mockRejectedValue(new Error("Settings unavailable"));
    const speech = useSpeech(course);
    expect(await speech.play("Hello.")).toBe(true);
    expect(mocks.playCourseAudio).toHaveBeenCalled();
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(speech.settingsError.value).toContain("Settings unavailable");
  });
  it("pauses a generation job and reloads retained progress", async () => {
    let reject!: (error: unknown) => void;
    mocks.generateCourseAudio.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    mocks.cancelCourseAudioGeneration.mockImplementation(async () =>
      reject({ code: "COURSE_AUDIO_CANCELLED" }),
    );
    const speech = useSpeech(course);
    await speech.load();
    const pending = speech.generateCourse();
    await vi.waitFor(() => expect(speech.courseGenerating.value).toBe(true));
    await speech.cancelCourse();
    expect(await pending).toBe(false);
    expect(speech.courseGenerating.value).toBe(false);
  });
});
