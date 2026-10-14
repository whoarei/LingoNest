import { computed, ref } from "vue";
import { isAndroid, native } from "./native";
import { courseAudioSpec } from "./course-speech";
import {
  defaultSpeechConfiguration,
  type SpeechInput,
  type SpeechStatus,
  emptyCourseAudioStatus,
  type CourseAudioSpec,
} from "./speech-types";

export function useSpeech(course: CourseAudioSpec = courseAudioSpec) {
  const configuration = ref(defaultSpeechConfiguration());
  const ready = ref(false),
    settingsError = ref("");
  const phase = ref<SpeechStatus["phase"]>("idle");
  const lastCached = ref(false);
  const cache = ref({ count: 0, bytes: 0 });
  const courseAudio = ref(emptyCourseAudioStatus(course.assets.length));
  const courseError = ref("");
  const courseReady = ref(false);
  const courseGenerating = ref(false);
  const courseProgress = ref({ completed: 0, total: course.assets.length });
  const lastSource = ref<SpeechStatus["source"]>();
  let sequence = 0;
  let loaded: Promise<void> | undefined;
  const label = computed(() =>
    courseAudio.value.ready > 0
      ? `课程音频 · ${courseAudio.value.voice} · 本地长期保存`
      : configuration.value.mode === "ai"
        ? "课程音频待生成 · 请到设置中准备"
        : "设备音色 · 需已安装英语离线语音包",
  );
  async function load() {
    if (!loaded)
      loaded = (async () => {
        if (isAndroid) {
          configuration.value = await native.getSpeechConfig();
          cache.value = await native
            .getSpeechCacheInfo()
            .catch(() => ({ count: 0, bytes: 0 }));
        }
        ready.value = true;
        settingsError.value = "";
        await refreshCourse().catch(() => {});
      })().catch((error) => {
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
    if (isAndroid) await native.stopSpeech();
    else window.speechSynthesis?.cancel();
  }
  async function playText(text: string, preview: boolean) {
    const token = ++sequence;
    await load().catch((error) => {
      if (preview) throw error;
    });
    if (token !== sequence) return false;
    phase.value =
      preview && configuration.value.mode === "ai" ? "generating" : "playing";
    lastCached.value = false;
    lastSource.value = undefined;
    try {
      if (isAndroid) {
        const asset = course.assets.find(
          (asset) => asset.text === text.trim().normalize("NFC"),
        );
        if (!preview && !asset)
          throw new Error("该文字不在课程音频资源清单中。");
        const result = preview
          ? await native.speak({ text })
          : await native.playCourseAudio({ course, assetId: asset!.id });
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
        speechSynthesis.cancel();
        await new Promise<void>((resolve, reject) => {
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
      if (token === sequence) phase.value = "idle";
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
    if (isAndroid) cache.value = await native.getSpeechCacheInfo();
  }
  async function clearCache() {
    if (isAndroid) {
      await stop();
      await native.clearSpeechCache();
      await refreshCache();
    }
  }
  async function refreshCourse() {
    if (!isAndroid) return;
    try {
      courseAudio.value = await native.getCourseAudio({ course });
      courseReady.value = true;
      courseError.value = "";
    } catch (error) {
      courseError.value =
        error instanceof Error ? error.message : String(error);
      courseReady.value = false;
      throw error;
    }
  }
  async function generateCourse() {
    if (!isAndroid || courseGenerating.value) return false;
    await stop();
    courseGenerating.value = true;
    try {
      courseAudio.value = await native.generateCourseAudio({ course });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "COURSE_AUDIO_CANCELLED")
        throw error;
      return false;
    } finally {
      courseGenerating.value = false;
      await refreshCourse().catch(() => {});
    }
  }
  async function cancelCourse() {
    if (isAndroid) await native.cancelCourseAudioGeneration();
  }
  async function clearCourse() {
    if (isAndroid) {
      await cancelCourse();
      await stop();
      courseAudio.value = await native.clearCourseAudio({ course });
      courseReady.value = true;
      courseError.value = "";
    }
  }
  if (isAndroid)
    void native.addListener("speechStatus", (status) => {
      phase.value = status.phase;
      if (status.source) lastSource.value = status.source;
      if (status.cached !== undefined) lastCached.value = status.cached;
    });
  if (isAndroid)
    void native.addListener("courseAudioProgress", (status) => {
      courseGenerating.value = status.generating;
      if (status.total)
        courseProgress.value = {
          completed: status.completed,
          total: status.total,
        };
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
    courseTitle: course.title,
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
