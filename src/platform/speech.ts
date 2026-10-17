import {
  computed,
  ref,
  isRef,
  watch,
  getCurrentScope,
  onScopeDispose,
  type Ref,
} from "vue";
import { isAndroid, native } from "../native";
import {
  defaultSpeechConfiguration,
  type SpeechInput,
  type SpeechStatus,
  emptyCourseAudioStatus,
  type CourseAudioSpec,
  type SpeechConfiguration,
} from "../speech-types";

// Device playback is shared by all controllers. Keep ownership separate from UI
// status, and let a new request wait for an earlier owner's stop to finish.
let playbackOwner: { interrupt(): void } | undefined;
let playbackStopping: Promise<void> = Promise.resolve();
let generationOwner: { controller: object } | undefined;
let generationStopping: Promise<void> = Promise.resolve();

async function stopDevicePlayback() {
  if (!playbackOwner) return playbackStopping;
  const previous = playbackOwner;
  playbackOwner = undefined;
  previous.interrupt();
  const stopping = isAndroid
    ? native.stopSpeech()
    : Promise.resolve(window.speechSynthesis?.cancel());
  playbackStopping = stopping.catch(() => {});
  await stopping;
}

export function useSpeech(
  source: CourseAudioSpec | Ref<CourseAudioSpec>,
  sharedConfiguration?: Ref<SpeechConfiguration>,
) {
  const course = isRef(source) ? source : ref(source);
  const configuration =
    sharedConfiguration ?? ref(defaultSpeechConfiguration());
  const ready = ref(false),
    settingsError = ref("");
  const phase = ref<SpeechStatus["phase"]>("idle");
  const lastCached = ref(false);
  const cache = ref({ count: 0, bytes: 0 });
  const courseAudio = ref(emptyCourseAudioStatus(course.value.assets.length));
  const courseError = ref("");
  const courseReady = ref(false);
  const courseGenerating = ref(false);
  const courseProgress = ref({
    completed: 0,
    total: course.value.assets.length,
  });
  const lastSource = ref<SpeechStatus["source"]>();
  let sequence = 0;
  let loaded: Promise<void> | undefined;
  let courseEpoch = 0;
  let disposed = false;
  let activeSequence = 0;
  const owner = {
    interrupt() {
      if (sequence === activeSequence) sequence++;
      phase.value = "idle";
      finishBrowserPlayback?.();
      finishBrowserPlayback = undefined;
    },
  };
  let finishBrowserPlayback: (() => void) | undefined;
  const subscriptions: { remove(): Promise<void> }[] = [];
  function retainSubscription(handle: { remove(): Promise<void> }) {
    if (disposed) void handle.remove().catch(() => {});
    else subscriptions.push(handle);
  }
  const label = computed(() =>
    courseAudio.value.ready > 0
      ? `课程音频 · ${courseAudio.value.voice} · 本地长期保存`
      : configuration.value.mode === "ai"
        ? "课程音频待生成 · 请到家长空间的课程管理准备"
        : "设备音色 · 需已安装英语离线语音包",
  );
  async function load() {
    if (disposed) return;
    if (!loaded)
      loaded = (async () => {
        if (isAndroid) {
          const config = await native.getSpeechConfig();
          if (disposed) return;
          configuration.value = config;
          const info = await native
            .getSpeechCacheInfo()
            .catch(() => ({ count: 0, bytes: 0 }));
          if (disposed) return;
          cache.value = info;
        }
        ready.value = true;
        settingsError.value = "";
        await refreshCourse().catch(() => {});
      })().catch((error) => {
        if (disposed) return;
        settingsError.value =
          error instanceof Error ? error.message : String(error);
        loaded = undefined;
        void refreshCourse().catch(() => {});
        throw error;
      });
    return loaded;
  }
  async function stop() {
    sequence++;
    phase.value = "idle";
    if (playbackOwner === owner) await stopDevicePlayback();
  }
  function ownsPlayback(token: number) {
    return !disposed && token === sequence &&
      playbackOwner === owner && activeSequence === token;
  }
  async function beginPlayback(token: number, preview: boolean) {
    await playbackStopping;
    if (disposed || token !== sequence) return false;
    // Stop the old owner before transferring ownership. A rejected new request
    // must never leave old audio running without an owner that can stop it.
    while (playbackOwner) {
      await stopDevicePlayback();
      if (disposed || token !== sequence) return false;
    }
    playbackOwner = owner;
    activeSequence = token;
    phase.value =
      preview && configuration.value.mode === "ai" ? "generating" : "playing";
    lastCached.value = false;
    lastSource.value = undefined;
    return ownsPlayback(token);
  }
  async function playText(text: string, preview: boolean) {
    if (disposed) return false;
    const token = ++sequence;
    await load().catch((error) => {
      if (preview) throw error;
    });
    if (disposed || token !== sequence) return false;
    try {
      if (isAndroid) {
        const activeCourse = course.value;
        const asset = activeCourse.assets.find(
          (asset) => asset.text === text.trim().normalize("NFC"),
        );
        if (!preview && !asset)
          throw new Error("该文字不在课程音频资源清单中。");
        // Preparing playback yields to Vue updates. Unload or another request
        // can revoke the reservation before this continuation reaches the device.
        if (!(await beginPlayback(token, preview)) || !ownsPlayback(token)) return false;
        const result = preview
          ? await native.speak({ text })
          : await native.playCourseAudio({
              course: activeCourse,
              assetId: asset!.id,
            });
        if (token === sequence) {
          lastCached.value = !!result?.cached;
          lastSource.value = result?.source;
          if (result?.source === "ai") void refreshCache().catch(() => {});
        }
      } else {
        if (configuration.value.mode === "ai")
          throw new Error(
            "AI 语音配置和生成请使用 Android 应用，浏览器只提供设备朗读预览。",
          );
        const voice = window.speechSynthesis
          ?.getVoices()
          .find((v) => v.lang.startsWith("en") && v.localService);
        if (!voice)
          throw new Error(
            "设备没有可用的离线英语音色。请安装英语语音包，或请家长朗读。",
          );
        if (!(await beginPlayback(token, preview)) || !ownsPlayback(token)) return false;
        speechSynthesis.cancel();
        if (!ownsPlayback(token)) return false;
        await new Promise<void>((resolve, reject) => {
          finishBrowserPlayback = resolve;
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.voice = voice;
          utterance.lang = voice.lang;
          utterance.rate = configuration.value.speed;
          utterance.onend = () => resolve();
          utterance.onerror = (event) =>
            event.error === "canceled" || event.error === "interrupted"
              ? resolve()
              : reject(new Error("设备朗读失败。"));
          speechSynthesis.speak(utterance);
        });
      }
    } catch (error) {
      if (
        (error as { code?: string }).code !== "AUDIO_INTERRUPTED" &&
        token === sequence
      )
        throw error;
      return false;
    } finally {
      if (playbackOwner === owner && activeSequence === token) {
        playbackOwner = undefined;
        phase.value = "idle";
        finishBrowserPlayback = undefined;
      }
    }
    return token === sequence;
  }
  const play = (text: string) => playText(text, false);
  const preview = (text: string) => playText(text, true);
  async function save(input: SpeechInput) {
    if (!isAndroid) throw new Error("API Key 配置请在 Android 应用中保存。");
    await stop();
    configuration.value = await native.setSpeechConfig(input);
    ready.value = true;
    settingsError.value = "";
    loaded = Promise.resolve();
    await refreshCourse().catch(() => {});
  }
  async function reset() {
    if (!isAndroid) return;
    await stop();
    configuration.value = await native.clearSpeechConfig();
    ready.value = true;
    settingsError.value = "";
    loaded = Promise.resolve();
    await refreshCourse().catch(() => {});
  }
  async function refreshCache() {
    if (isAndroid && !disposed) {
      const result = await native.getSpeechCacheInfo();
      if (!disposed) cache.value = result;
    }
  }
  async function clearCache() {
    if (isAndroid) {
      await stop();
      await native.clearSpeechCache();
      await refreshCache();
    }
  }
  async function refreshCourse() {
    if (!isAndroid || disposed) return;
    if (!course.value.assets.length) {
      courseAudio.value = emptyCourseAudioStatus(0); courseReady.value = false; courseError.value = ""; return;
    }
    const epoch = courseEpoch;
    try {
      const result = await native.getCourseAudio({ course: course.value });
      if (epoch !== courseEpoch) return;
      courseAudio.value = result;
      courseReady.value = true;
      courseError.value = "";
    } catch (error) {
      if (epoch !== courseEpoch) return;
      courseError.value =
        error instanceof Error ? error.message : String(error);
      courseReady.value = false;
      throw error;
    }
  }
  async function generateCourse() {
    if (!isAndroid || disposed || !course.value.assets.length || courseGenerating.value || generationOwner) return false;
    const epoch = courseEpoch;
    const canStart = () => !disposed && epoch === courseEpoch && !generationOwner;
    await stop();
    if (!canStart()) return false;
    await generationStopping;
    if (!canStart()) return false;
    await stopDevicePlayback();
    if (!canStart()) return false;
    const job = { controller: owner };
    generationOwner = job;
    courseGenerating.value = true;
    try {
      if (disposed || epoch !== courseEpoch || generationOwner !== job) return false;
      const result = await native.generateCourseAudio({
        course: course.value,
      });
      if (disposed || epoch !== courseEpoch || generationOwner !== job) return false;
      courseAudio.value = result;
      return true;
    } catch (error) {
      if (!disposed && epoch === courseEpoch && generationOwner === job &&
        (error as { code?: string }).code !== "COURSE_AUDIO_CANCELLED")
        throw error;
      return false;
    } finally {
      if (generationOwner === job) generationOwner = undefined;
      courseGenerating.value = false;
      await refreshCourse().catch(() => {});
    }
  }
  async function cancelCourse() {
    if (isAndroid && generationOwner?.controller === owner) {
      generationOwner = undefined;
      const stopping = native.cancelCourseAudioGeneration();
      generationStopping = stopping.catch(() => {});
      await stopping;
    }
  }
  async function clearCourse() {
    if (isAndroid) {
      await cancelCourse();
      await stop();
      courseAudio.value = await native.clearCourseAudio({
        course: course.value,
      });
      courseReady.value = true;
      courseError.value = "";
    }
  }
  if (isAndroid)
    void native
      .addListener("speechStatus", (status) => {
        if (disposed || playbackOwner !== owner) return;
        phase.value = status.phase;
        if (status.source) lastSource.value = status.source;
        if (status.cached !== undefined) lastCached.value = status.cached;
      })
      .then(retainSubscription)
      .catch(() => {});
  if (isAndroid)
    void native
      .addListener("courseAudioProgress", (status) => {
        if (disposed || generationOwner?.controller !== owner) return;
        courseGenerating.value = status.generating;
        if (status.total)
          courseProgress.value = {
            completed: status.completed,
            total: status.total,
          };
      })
      .then(retainSubscription)
      .catch(() => {});
  watch(course, async (next, previous) => {
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    courseEpoch++;
    await cancelCourse();
    await stop();
    if (disposed) return;
    courseReady.value = false;
    courseAudio.value = emptyCourseAudioStatus(next.assets.length);
    courseProgress.value = { completed: 0, total: next.assets.length };
    await refreshCourse().catch(() => {});
  });
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      courseEpoch++;
      void stop().catch(() => {});
      void cancelCourse().catch(() => {});
      subscriptions.forEach((handle) => {
        void handle.remove().catch(() => {});
      });
    });
  void load().catch(() => {});
  return {
    configuration,
    ready,
    settingsError,
    phase,
    lastCached,
    cache,
    label,
    play,
    preview,
    lastSource,
    courseAudio,
    courseReady,
    courseError,
    courseGenerating,
    courseProgress,
    courseTitle: computed(() => course.value.title),
    courseSpec: course,
    refreshCourse,
    generateCourse,
    cancelCourse,
    clearCourse,
    stop,
    save,
    reset,
    refreshCache,
    clearCache,
    load,
    supported: isAndroid,
  };
}
export type SpeechController = ReturnType<typeof useSpeech>;
