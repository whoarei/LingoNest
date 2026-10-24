import { starterMaterial } from "/packages/materials/starter.ts";
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
// This is synthetic UI fixture seeding, not a production migration path.
const catalogSlot = "native-document:lingonest.catalog.v1", sevenSlot = "native-document:lingonest.seven-step.v1";
const envelope = (value, revision = 7) => JSON.stringify({ revision, payload: JSON.stringify(value) });
const readSlot = key => { const value = sessionStorage.getItem(key); return value ? JSON.parse(JSON.parse(value).payload) : null; };
if (state.payload && state.payload !== sessionStorage.getItem("fixture-last-view")) {
  const seed = JSON.parse(state.payload);
  sessionStorage.setItem(catalogSlot, envelope({ formatVersion: 1, learners: seed.learners, activeLearnerId: seed.activeLearnerId,
    defaultCourseId: starterMaterial.id, learningCourseIds: seed.learningCourseIds,
    courses: [{ ...starterMaterial, sourceRevision: "source.starter.1", builtin: true, archivedAt: null }, ...seed.courses.map(record => ({
      id: record.id, title: record.title, subtitle: record.subtitle, sourceText: record.sourceText, images: record.images,
      supplementImages: record.vocabularyImages, sourceRevision: "source.fixture.1", archivedAt: record.deletedAt ?? null, builtin: false,
    }))] }));
  sessionStorage.setItem(sevenSlot, envelope({ formatVersion: 1, courses: seed.courses.map(({ deletedAt, ...record }) => record),
    events: seed.events, runs: seed.runs, confirmedCourses: seed.confirmedCourses, lastObservedAt: seed.lastObservedAt }));
}
function updateView() {
  const catalog = readSlot(catalogSlot); if (!catalog) return;
  const saved = readSlot(sevenSlot);
  const seven = Array.isArray(saved?.courses) ? saved : { courses: [], events: [], runs: [], confirmedCourses: [], lastObservedAt: null };
  const courses = catalog.courses.filter(item => !item.builtin).map(material => {
    const record = seven.courses.find(item => item.id === material.id);
    const sameSource = record && JSON.stringify([record.title, record.subtitle, record.sourceText, record.images, record.vocabularyImages]) ===
      JSON.stringify([material.title, material.subtitle, material.sourceText, material.images, material.supplementImages]);
    return { ...(sameSource || record?.status === "published" ? record : { id: material.id, title: material.title, subtitle: material.subtitle,
      sourceText: material.sourceText, images: material.images, vocabularyImages: material.supplementImages, vocabulary: record?.vocabulary ?? [],
      status: "source", package: null, recipe: null, updatedAt: "2026-10-24T00:00:00.000Z" }), ...(material.archivedAt ? { deletedAt: material.archivedAt } : {}) };
  });
  state.payload = JSON.stringify({ ...seven, formatVersion: 2, courseVersion: "0.1.0", courses, learners: catalog.learners,
    activeLearnerId: catalog.activeLearnerId, learningCourseIds: catalog.learningCourseIds, confirmedLearnerIds: [], pendingDeletions: [], pendingCourseDeletions: [] });
  sessionStorage.setItem("fixture-last-view", state.payload);
}
updateView();
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
  loadDocument: async ({ key }) => {
    if (key === 'lingonest.passage-path.v2' && window.__modeReadFailure) throw Error('模拟模式读取暂时失败');
    return JSON.parse(sessionStorage.getItem('native-document:' + key) || '{"revision":0,"payload":null}');
  },
  saveDocument: async ({ key, expectedRevision, payload }) => {
    if (window.__modeSaveFailure) throw Error('模拟模式设置保存失败');
    if (window.__saveFailure && ['lingonest.catalog.v1', 'lingonest.seven-step.v1'].includes(key)) throw Error('模拟保存失败');
    if (window.__documentSaveDelay) await new Promise(resolve => setTimeout(resolve, window.__documentSaveDelay));
    const current = JSON.parse(sessionStorage.getItem('native-document:' + key) || '{"revision":0,"payload":null}');
    if (current.revision !== expectedRevision) throw Error('课程模式设置已更新，请重新打开');
    const next = { revision: current.revision + 1, payload };
    sessionStorage.setItem('native-document:' + key, JSON.stringify(next));
    if (['lingonest.catalog.v1', 'lingonest.seven-step.v1'].includes(key)) { updateView(); persist(); }
    return { revision: next.revision };
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
  cancelRecording: async () => { window.__recordingOwner = null; },
  startRecording: async ({ learnerId }) => {
    if (window.__microphoneDenied) throw Object.assign(Error("未允许麦克风"), { code: "MICROPHONE_DENIED" });
    if (window.__recordingStartDelay) await new Promise(resolve => setTimeout(resolve, window.__recordingStartDelay));
    window.__recordingOwner = learnerId;
  },
  stopRecording: async () => {
    if (window.__recordingInvalid) throw Object.assign(Error("录音太短，请重新录制。"), { code: "RECORDING_TOO_SHORT" });
    state.recordingCounter = (state.recordingCounter || 0) + 1; persist();
    const path = `recordings/${window.__recordingOwner}/take-${state.recordingCounter}.m4a`; window.__recordingOwner = null;
    return { path };
  },
  openAppSettings: async () => { window.__openedAppSettings = true; },
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
    await new Promise((r) => setTimeout(r, window.__coursePlaybackDelay || 100));
    emit("speechStatus", { phase: "idle" });
    return { source: "course" };
  },
};
