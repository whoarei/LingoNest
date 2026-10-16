import { effectScope, watch } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/native", () => ({ isAndroid: false, native: {} }));
import { useSpeech } from "../src/platform/speech";

afterEach(() => vi.unstubAllGlobals());
describe("browser media on mode unload", () => {
  it.each(["post", "sync"] as const)("does not start synthesis when unloaded at the %s playback-state update", async (flush) => {
    const speak = vi.fn((utterance: SpeechSynthesisUtterance) => {
      // Settle an erroneous start too, so a regression fails without hanging.
      utterance.onend?.({} as SpeechSynthesisEvent);
    });
    const synthesis = { getVoices: () => [{ lang: "en-US", localService: true }], speak, cancel: vi.fn() };
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    const scope = effectScope();
    const speech = scope.run(() => {
      const instance = useSpeech({ courseId: "old", courseVersion: "1", title: "Old", assets: [] });
      watch(instance.phase, phase => { if (phase === "playing") scope.stop(); }, { flush });
      return instance;
    })!;
    try {
      expect(await speech.preview("Hello.")).toBe(false);
      expect(scope.active).toBe(false);
      expect(speak).not.toHaveBeenCalled();
      expect(speech.phase.value).toBe("idle");
    } finally { scope.stop(); }
  });

  it("cancels owned synthesis and settles pending playback even if the browser emits no cancel event", async () => {
    const speak = vi.fn(), cancel = vi.fn();
    const synthesis = { getVoices: () => [{ lang: "en-US", localService: true }], speak, cancel };
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("speechSynthesis", synthesis);
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    const scope = effectScope(), idle = effectScope();
    const source = { courseId: "old", courseVersion: "1", title: "Old", assets: [] };
    const speech = scope.run(() => useSpeech(source))!;
    idle.run(() => useSpeech(source));
    const pending = speech.preview("Hello.");
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    const cancelsBeforeUnload = cancel.mock.calls.length;
    idle.stop();
    expect(cancel).toHaveBeenCalledTimes(cancelsBeforeUnload);
    scope.stop();
    expect(cancel).toHaveBeenCalledTimes(cancelsBeforeUnload + 1);
    expect(await pending).toBe(false);
    speak.mock.calls[0]![0].onend();
    expect(speech.phase.value).toBe("idle");
    expect(await speech.preview("Hello.")).toBe(false);
  });
});
