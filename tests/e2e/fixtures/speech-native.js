// UI-only native fixture. Session state simulates an installed app across WebView reloads.
export const isAndroid = true;
const defaults = () => ({
  mode: "device",
  protocol: "openai-speech",
  baseUrl: "",
  model: "",
  voice: "alloy",
  speed: 0.9,
  instructions: "",
  hasKey: false,
});
const state = JSON.parse(
  sessionStorage.getItem("speech-native-fixture") || "null",
) || {
  cfg: defaults(),
  revision: 0,
  payload: null,
  cache: [],
  total: 44,
  variants: {},
  active: "",
  draft: "",
  requests: 0,
  plays: 0,
};
const listeners = {};
let epoch = 0;
const persist = () => {
  sessionStorage.setItem("speech-native-fixture", JSON.stringify(state));
  window.__speechRequests = state.requests;
  window.__coursePlays = state.plays;
};
const key = () =>
  JSON.stringify([
    state.cfg.protocol,
    state.cfg.baseUrl,
    state.cfg.model,
    state.cfg.voice,
    state.cfg.instructions,
  ]);
const emit = (name, event) => listeners[name]?.(event);
const status = () => {
  const selected = state.variants[state.active || state.draft];
  const pending =
    state.draft && state.draft !== state.active && state.active
      ? state.variants[state.draft]
      : null;
  return {
    total: state.total,
    ready: selected?.files.length || 0,
    bytes: (selected?.files.length || 0) * 1024,
    complete: selected?.files.length === state.total,
    voice: selected?.voice || "",
    model: selected?.model || "",
    matchesSettings: (state.active || state.draft) === key(),
    pending: pending
      ? {
          ready: pending.files.length,
          total: state.total,
          voice: pending.voice,
        }
      : null,
  };
};
const cancelled = () =>
  Object.assign(new Error("课程音频生成已暂停，已完成部分保留。"), {
    code: "COURSE_AUDIO_CANCELLED",
  });
const network = () => {
  if (window.__speechOffline) throw Error("Network offline");
};
persist();
export const native = {
  loadState: async () => ({ revision: state.revision, payload: state.payload }),
  saveState: async (input) => {
    state.revision++;
    state.payload = input.payload;
    persist();
    return { revision: state.revision };
  },
  getSpeechConfig: async () => ({ ...state.cfg }),
  setSpeechConfig: async (input) => {
    const { apiKey, ...safe } = input;
    state.cfg = { ...safe, hasKey: !!apiKey || state.cfg.hasKey };
    persist();
    return { ...state.cfg };
  },
  clearSpeechConfig: async () => {
    state.cfg = defaults();
    persist();
    return { ...state.cfg };
  },
  getSpeechCacheInfo: async () => ({
    count: state.cache.length,
    bytes: state.cache.length * 1024,
  }),
  clearSpeechCache: async () => {
    state.cache = [];
    persist();
  },
  addListener: async (name, callback) => {
    listeners[name] = callback;
    return { remove: async () => delete listeners[name] };
  },
  stopSpeech: async () => emit("speechStatus", { phase: "idle" }),
  stopAudio: async () => {},
  cancelRecording: async () => {},
  speak: async ({ text }) => {
    const id = key() + text,
      cached = state.cache.includes(id);
    if (!cached) {
      network();
      state.cache.push(id);
      state.requests++;
      persist();
    }
    emit("speechStatus", { phase: "playing", source: "ai", cached });
    await new Promise((r) => setTimeout(r, 100));
    emit("speechStatus", { phase: "idle" });
    return { cached, source: "ai" };
  },
  getCourseAudio: async ({ course }) => {
    state.total = course.assets.length;
    persist();
    return status();
  },
  generateCourseAudio: async ({ course }) => {
    if (!state.cfg.hasKey || state.cfg.mode !== "ai")
      throw Error("Configure AI speech first");
    const token = ++epoch,
      id = key();
    state.total = course.assets.length;
    const variant = (state.variants[id] ||= {
      voice: state.cfg.voice,
      model: state.cfg.model,
      files: [],
    });
    state.draft = id;
    persist();
    emit("courseAudioProgress", {
      generating: true,
      completed: variant.files.length,
      total: state.total,
    });
    for (const asset of course.assets) {
      if (token !== epoch) throw cancelled();
      if (!variant.files.includes(asset.id)) {
        network();
        await new Promise((r) => setTimeout(r, window.__speechDelay || 20));
        if (token !== epoch) throw cancelled();
        variant.files.push(asset.id);
        state.requests++;
        persist();
      }
      emit("courseAudioProgress", {
        generating: true,
        completed: variant.files.length,
        total: state.total,
      });
    }
    state.active = id;
    state.draft = "";
    persist();
    emit("courseAudioProgress", {
      generating: false,
      completed: state.total,
      total: state.total,
    });
    return status();
  },
  cancelCourseAudioGeneration: async () => {
    epoch++;
    emit("courseAudioProgress", { generating: false, completed: 0, total: 0 });
  },
  clearCourseAudio: async () => {
    epoch++;
    state.variants = {};
    state.active = "";
    state.draft = "";
    persist();
    return status();
  },
  playCourseAudio: async ({ course, assetId }) => {
    const variant = state.variants[state.active || state.draft];
    if (
      !course.assets.some((asset) => asset.id === assetId) ||
      !variant?.files.includes(assetId)
    )
      throw Object.assign(
        new Error(
          "本段课程音频未就绪，请在设置中生成或继续生成整课音频。学习时不会自动调用 API。",
        ),
        { code: "COURSE_AUDIO_MISSING" },
      );
    state.plays++;
    persist();
    emit("speechStatus", { phase: "playing", source: "course" });
    await new Promise((r) => setTimeout(r, 100));
    emit("speechStatus", { phase: "idle" });
    return { source: "course" };
  },
};
