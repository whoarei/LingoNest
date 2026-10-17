import { effectScope, watch } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSpeechConfiguration, emptyCourseAudioStatus } from "../src/speech-types";

const native = vi.hoisted(() => ({
  getSpeechConfig: vi.fn(), getSpeechCacheInfo: vi.fn(), getCourseAudio: vi.fn(),
  stopSpeech: vi.fn(), playCourseAudio: vi.fn(), speak: vi.fn(),
  generateCourseAudio: vi.fn(), cancelCourseAudioGeneration: vi.fn(), addListener: vi.fn(),
}));
vi.mock("../src/native", () => ({ isAndroid: true, native }));
import { useSpeech } from "../src/platform/speech";

const course = { courseId: "legacy.course", courseVersion: "1", title: "Old course", assets: [{ id: "hello", text: "Hello." }] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function controller() {
  const scope = effectScope();
  return { scope, speech: scope.run(() => useSpeech(course))! };
}
beforeEach(() => {
  vi.resetAllMocks();
  native.getSpeechConfig.mockResolvedValue(defaultSpeechConfiguration());
  native.getSpeechCacheInfo.mockResolvedValue({ count: 0, bytes: 0 });
  native.getCourseAudio.mockResolvedValue(emptyCourseAudioStatus(1));
  native.stopSpeech.mockResolvedValue(undefined);
  native.cancelCourseAudioGeneration.mockResolvedValue(undefined);
  native.addListener.mockResolvedValue({ remove: vi.fn(async () => {}) });
});

describe("native media ownership on mode unload", () => {
  it("keeps material-only courses out of native audio requests without borrowing another course's assets", async () => {
    const scope = effectScope();
    const speech = scope.run(() => useSpeech({ ...course, courseId: "material-only", assets: [] }))!;
    try {
      await speech.load();
      expect(native.getCourseAudio).not.toHaveBeenCalled();
      expect(await speech.generateCourse()).toBe(false);
      expect(native.generateCourseAudio).not.toHaveBeenCalled();
      expect(speech.courseReady.value).toBe(false);
      expect(speech.courseError.value).toBe("");
    } finally { scope.stop(); }
  });
  it.each([
    { method: "play", flush: "post" },
    { method: "preview", flush: "post" },
    { method: "play", flush: "sync" },
    { method: "preview", flush: "sync" },
  ] as const)("does not start $method when unloaded at the $flush playback-state update", async ({ method, flush }) => {
    native.playCourseAudio.mockResolvedValue({ source: "course" });
    native.speak.mockResolvedValue({ source: "device" });
    const scope = effectScope();
    const speech = scope.run(() => {
      const instance = useSpeech(course);
      watch(instance.phase, phase => {
        if (phase === "playing") scope.stop();
      }, { flush });
      return instance;
    })!;
    try {
      expect(await speech[method]("Hello.")).toBe(false);
      expect(scope.active).toBe(false);
      expect(native.playCourseAudio).not.toHaveBeenCalled();
      expect(native.speak).not.toHaveBeenCalled();
      expect(speech.phase.value).toBe("idle");
    } finally { scope.stop(); }
  });

  it("does not stop another instance when a queued generation request is unloaded", async () => {
    const playback = deferred<{ source: string }>();
    native.playCourseAudio.mockReturnValue(playback.promise);
    const active = controller(), queued = controller();
    const pendingPlayback = active.speech.play("Hello.");
    try {
      await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(1));
      const generation = queued.speech.generateCourse();
      queued.scope.stop();
      expect(await generation).toBe(false);
      expect(native.generateCourseAudio).not.toHaveBeenCalled();
      expect(native.stopSpeech).not.toHaveBeenCalled();
      expect(active.speech.phase.value).toBe("playing");
    } finally {
      queued.scope.stop();
      active.scope.stop();
      playback.resolve({ source: "course" });
      await pendingPlayback;
    }
  });

  it("does not stop another instance after an unloaded request finishes waiting for generation cancellation", async () => {
    const oldJob = deferred<ReturnType<typeof emptyCourseAudioStatus>>();
    const cancelling = deferred<void>();
    const playback = deferred<{ source: string }>();
    native.generateCourseAudio.mockReturnValue(oldJob.promise);
    native.cancelCourseAudioGeneration.mockReturnValue(cancelling.promise);
    native.playCourseAudio.mockReturnValue(playback.promise);
    const previous = controller(), active = controller(), queued = controller();
    const oldGeneration = previous.speech.generateCourse();
    let pendingPlayback: Promise<boolean> | undefined;
    try {
      await vi.waitFor(() => expect(native.generateCourseAudio).toHaveBeenCalledTimes(1));
      const cancellation = previous.speech.cancelCourse();
      pendingPlayback = active.speech.play("Hello.");
      await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(1));
      const pending = queued.speech.generateCourse();
      // Its first continuation runs before this one and waits at the native
      // cancellation barrier. Unload while that barrier is still pending.
      await Promise.resolve();
      queued.scope.stop();
      cancelling.resolve();
      await cancellation;
      expect(await pending).toBe(false);
      expect(native.generateCourseAudio).toHaveBeenCalledTimes(1);
      expect(native.stopSpeech).not.toHaveBeenCalled();
      expect(active.speech.phase.value).toBe("playing");
    } finally {
      cancelling.resolve();
      oldJob.reject({ code: "COURSE_AUDIO_CANCELLED" });
      previous.scope.stop();
      queued.scope.stop();
      active.scope.stop();
      playback.resolve({ source: "course" });
      await oldGeneration;
      await pendingPlayback;
    }
  });

  it("does not start native generation when its generating-state observer unloads synchronously", async () => {
    native.generateCourseAudio.mockResolvedValue(emptyCourseAudioStatus(1));
    const scope = effectScope();
    const speech = scope.run(() => {
      const instance = useSpeech(course);
      watch(instance.courseGenerating, generating => { if (generating) scope.stop(); }, { flush: "sync" });
      return instance;
    })!;
    try {
      expect(await speech.generateCourse()).toBe(false);
      expect(scope.active).toBe(false);
      expect(native.generateCourseAudio).not.toHaveBeenCalled();
      expect(speech.courseGenerating.value).toBe(false);
    } finally { scope.stop(); }
  });

  it.each(["play", "preview"] as const)("stops active %s once, removes listeners and ignores late results/events", async (method) => {
    const playback = deferred<{ source: string; cached: boolean }>();
    native.playCourseAudio.mockReturnValue(playback.promise);
    native.speak.mockReturnValue(playback.promise);
    const { scope, speech } = controller();
    const pending = speech[method]("Hello.");
    await vi.waitFor(() => expect(speech.phase.value).toBe("playing"));
    scope.stop();
    scope.stop();
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    for (const [, listener] of native.addListener.mock.calls) listener({ phase: "playing", source: "ai", cached: true });
    playback.resolve({ source: "ai", cached: true });
    expect(await pending).toBe(false);
    expect(speech.phase.value).toBe("idle");
    expect(speech.lastSource.value).toBeUndefined();
    expect(speech.lastCached.value).toBe(false);
    const handle = await native.addListener.mock.results[0]!.value;
    await vi.waitFor(() => expect(handle.remove).toHaveBeenCalledTimes(2));
    expect(await speech.play("Hello.")).toBe(false);
    expect(await speech.generateCourse()).toBe(false);
  });

  it("does not start playback or publish settings when unloaded during configuration loading", async () => {
    const config = deferred<ReturnType<typeof defaultSpeechConfiguration>>();
    native.getSpeechConfig.mockReturnValue(config.promise);
    const { scope, speech } = controller();
    const pending = speech.play("Hello.");
    scope.stop();
    config.resolve({ ...defaultSpeechConfiguration(), voice: "late voice" });
    expect(await pending).toBe(false);
    expect(native.playCourseAudio).not.toHaveBeenCalled();
    expect(native.stopSpeech).not.toHaveBeenCalled();
    expect(speech.ready.value).toBe(false);
    expect(speech.configuration.value.voice).not.toBe("late voice");
  });

  it("does not stop another controller when an idle or superseded scope is unloaded", async () => {
    const first = deferred<{ source: string }>();
    const second = deferred<{ source: string }>();
    native.playCourseAudio.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = controller(), idle = controller(), b = controller();
    const playingA = a.speech.play("Hello.");
    await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(1));
    const playingB = b.speech.play("Hello.");
    await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(2));
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    idle.scope.stop();
    a.scope.stop();
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    first.reject(new Error("late failure from old mode"));
    expect(await playingA).toBe(false);
    expect(b.speech.phase.value).toBe("playing");
    b.scope.stop();
    expect(native.stopSpeech).toHaveBeenCalledTimes(2);
    second.resolve({ source: "course" });
    expect(await playingB).toBe(false);
  });

  it("leaves the active owner intact when another controller requests an unregistered asset", async () => {
    const playback = deferred<{ source: string }>();
    native.playCourseAudio.mockReturnValue(playback.promise);
    const a = controller(), b = controller();
    const pending = a.speech.play("Hello.");
    await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(1));
    await expect(b.speech.play("Unknown")).rejects.toThrow("资源清单");
    b.scope.stop();
    expect(native.stopSpeech).not.toHaveBeenCalled();
    a.scope.stop();
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    playback.resolve({ source: "course" });
    expect(await pending).toBe(false);
  });

  it("stops the previous stream before transferring ownership even when the new device request fails", async () => {
    const playback = deferred<{ source: string }>();
    native.playCourseAudio.mockReturnValueOnce(playback.promise).mockRejectedValueOnce(new Error("Device unavailable"));
    const a = controller(), b = controller();
    const pending = a.speech.play("Hello.");
    await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(1));
    await expect(b.speech.play("Hello.")).rejects.toThrow("Device unavailable");
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
    a.scope.stop();
    b.scope.stop();
    playback.resolve({ source: "course" });
    expect(await pending).toBe(false);
  });

  it("waits for the old native stop before starting playback in the next mode", async () => {
    const first = deferred<{ source: string }>(), second = deferred<{ source: string }>();
    const stopping = deferred<void>();
    native.stopSpeech.mockReturnValue(stopping.promise);
    native.playCourseAudio.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = controller();
    const playingA = a.speech.play("Hello.");
    await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(1));
    a.scope.stop();
    const b = controller();
    await b.speech.load();
    const playingB = b.speech.play("Hello.");
    await Promise.resolve();
    expect(native.playCourseAudio).toHaveBeenCalledTimes(1);
    stopping.resolve();
    await vi.waitFor(() => expect(native.playCourseAudio).toHaveBeenCalledTimes(2));
    first.resolve({ source: "course" });
    expect(await playingA).toBe(false);
    expect(b.speech.phase.value).toBe("playing");
    second.resolve({ source: "course" });
    expect(await playingB).toBe(true);
    b.scope.stop();
    expect(native.stopSpeech).toHaveBeenCalledTimes(1);
  });

  it("cancels only the unloading owner's generation and retains installed audio on late completion", async () => {
    const installed = { ...emptyCourseAudioStatus(1), ready: 1, complete: true, voice: "old voice" };
    native.getCourseAudio.mockResolvedValue(installed);
    const generation = deferred<typeof installed>();
    native.generateCourseAudio.mockReturnValue(generation.promise);
    const a = controller(), idle = controller();
    await a.speech.load();
    const pending = a.speech.generateCourse();
    await vi.waitFor(() => expect(native.generateCourseAudio).toHaveBeenCalledTimes(1));
    idle.scope.stop();
    expect(native.cancelCourseAudioGeneration).not.toHaveBeenCalled();
    a.scope.stop();
    expect(native.cancelCourseAudioGeneration).toHaveBeenCalledTimes(1);
    generation.resolve({ ...installed, voice: "late voice" });
    expect(await pending).toBe(false);
    expect(a.speech.courseAudio.value).toEqual(installed);
    expect(a.speech.courseGenerating.value).toBe(false);
  });

  it("does not start generation after its scope is synchronously unloaded", async () => {
    const { scope, speech } = controller();
    const pending = speech.generateCourse();
    scope.stop();
    expect(await pending).toBe(false);
    expect(native.generateCourseAudio).not.toHaveBeenCalled();
  });
});
