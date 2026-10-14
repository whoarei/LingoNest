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
state.resources ||= {};
const resource = (course) =>
  (state.resources[course.courseId + ":" + course.courseVersion] ||= {
    total: course.assets.length,
    variants: {},
    active: "",
    draft: "",
  });
let epoch = 0;
let playbackEpoch = 0;
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
const emit = (name, event) =>
  listeners[name]?.forEach((callback) => callback(event));
window.__nativeBack = () => emit("backButton", {});
window.__cleanupFailure = sessionStorage.getItem("cleanup-failure") === "true";
const status = (course) => {
  const audio = resource(course);
  const selected = audio.variants[audio.active || audio.draft];
  const pending =
    audio.draft && audio.draft !== audio.active && audio.active
      ? audio.variants[audio.draft]
      : null;
  return {
    total: audio.total,
    ready: selected?.files.length || 0,
    bytes: (selected?.files.length || 0) * 1024,
    complete: selected?.files.length === audio.total,
    voice: selected?.voice || "",
    model: selected?.model || "",
    matchesSettings: (audio.active || audio.draft) === key(),
    pending: pending
      ? {
          ready: pending.files.length,
          total: audio.total,
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
    if (window.__saveFailure) throw Error("模拟保存失败");
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
    (listeners[name] ||= new Set()).add(callback);
    return { remove: async () => listeners[name]?.delete(callback) };
  },
  stopSpeech: async () => emit("speechStatus", { phase: "idle" }),
  stopAudio: async () => {
    playbackEpoch++;
  },
  playRecording: async () => {
    const token = ++playbackEpoch;
    await new Promise((resolve) =>
      setTimeout(resolve, window.__recordingDelay || 100),
    );
    if (token !== playbackEpoch) throw Error("录音播放已停止。");
    if (window.__recordingUnavailable) throw Error("录音不存在或已删除。");
  },
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
    resource(course).total = course.assets.length;
    persist();
    return status(course);
  },
  generateCourseAudio: async ({ course }) => {
    const audio = resource(course);
    if (!state.cfg.hasKey || state.cfg.mode !== "ai")
      throw Error("Configure AI speech first");
    const token = ++epoch,
      id = key();
    audio.total = course.assets.length;
    const variant = (audio.variants[id] ||= {
      voice: state.cfg.voice,
      model: state.cfg.model,
      files: [],
    });
    audio.draft = id;
    persist();
    emit("courseAudioProgress", {
      generating: true,
      completed: variant.files.length,
      total: audio.total,
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
        total: audio.total,
      });
    }
    audio.active = id;
    audio.draft = "";
    persist();
    emit("courseAudioProgress", {
      generating: false,
      completed: audio.total,
      total: audio.total,
    });
    return status(course);
  },
  cancelCourseAudioGeneration: async () => {
    epoch++;
    emit("courseAudioProgress", { generating: false, completed: 0, total: 0 });
  },
  clearCourseAudio: async ({ course }) => {
    const audio = resource(course);
    epoch++;
    audio.variants = {};
    audio.active = "";
    audio.draft = "";
    persist();
    return status(course);
  },
  deleteCourseResources: async ({ course, images, recordings }) => {
    if (window.__cleanupFailure) throw Error("模拟资源清理失败");
    if (course)
      delete state.resources[course.courseId + ":" + course.courseVersion];
    window.__deletedResources = { course, images, recordings };
    persist();
  },
  exitApp: async () => {
    window.__appExited = true;
  },
  playCourseAudio: async ({ course, assetId }) => {
    const audio = resource(course);
    const variant = audio.variants[audio.active || audio.draft];
    if (
      !course.assets.some((asset) => asset.id === assetId) ||
      !variant?.files.includes(assetId)
    )
      throw Object.assign(
        new Error(
          "本段课程音频未就绪，请在家长空间的课程管理中生成或继续生成整课音频。学习时不会自动调用 API。",
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
