<script setup lang="ts">
import { ref, type UnwrapNestedRefs } from "vue";
import type { SpeechController } from "../platform/speech";
import Icon from "./AppIcon.vue";
import { useOperationNotices } from "../platform/notifications";
const props = defineProps<{
  speech: UnwrapNestedRefs<SpeechController>;
  authorize: (label: string, action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ settings: [] }>();
const busy = ref(false),
  message = ref(""),
  error = ref(""),
  confirmReset = ref(false);
const applicationNotices = useOperationNotices(message, error);
async function perform(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await action();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
async function generate() {
  await props.authorize("生成课程音频", () =>
    perform(async () => {
      const completed = await props.speech.generateCourse();
      message.value = completed
        ? "整课音频已保存为课程资源，可以反复离线学习。"
        : "生成已暂停，已完成部分保留，下次可以继续。";
    }),
  );
}
</script>
<template>
  <section
    class="section-panel course-audio-panel"
    aria-labelledby="course-audio-title"
  >
    <div class="section-heading">
      <h2 id="course-audio-title">本课音频资源 · {{ speech.courseTitle }}</h2>
      <Icon name="volume" />
    </div>
    <p v-if="!speech.supported" class="inline-note">
      音频生成和资源管理请使用 Android 应用。
    </p>
    <template v-else>
      <p v-if="speech.courseReady">
        {{ speech.courseAudio.ready }} / {{ speech.courseAudio.total }} 段已就绪
        · {{ (speech.courseAudio.bytes / 1024 / 1024).toFixed(1) }} MB<span
          v-if="speech.courseAudio.voice"
        >
          · {{ speech.courseAudio.voice }}</span
        >
      </p>
      <p v-else class="inline-note">
        {{ speech.courseError || "正在检查课程音频…" }}
        <button
          class="text-button"
          @click="speech.refreshCourse().catch(() => {})"
        >
          重新检查
        </button>
      </p>
      <p class="field-help">
        使用设置中保存的语音模型与音色生成，学习时播放本课已保存的音频。资源按课程独立保存，暂停后可继续。
      </p>
      <p
        v-if="
          !speech.configuration.hasKey || speech.configuration.mode !== 'ai'
        "
        class="inline-note"
      >
        生成音频前需要配置 AI 语音服务。<button
          class="text-button"
          @click="emit('settings')"
        >
          去设置配置语音模型
        </button>
      </p>
      <p v-else class="field-help">
        当前配置：{{ speech.configuration.model }} ·
        {{ speech.configuration.voice }}。<button
          class="text-button"
          @click="emit('settings')"
        >
          修改模型配置
        </button>
      </p>
      <p v-if="speech.courseAudio.pending" class="inline-note">
        新音色 {{ speech.courseAudio.pending.voice }}：{{
          speech.courseAudio.pending.ready
        }}
        / {{ speech.courseAudio.pending.total }} 段。完成前继续使用原课程音频。
      </p>
      <div v-if="speech.courseGenerating" role="status">
        <p>
          正在生成课程音频 {{ speech.courseProgress.completed }} /
          {{ speech.courseProgress.total }}
        </p>
        <progress
          :value="speech.courseProgress.completed"
          :max="speech.courseProgress.total"
        /><button class="button secondary compact" @click="speech.cancelCourse">
          暂停生成
        </button>
      </div>
      <div v-else class="speech-actions">
        <button
          class="button primary compact"
          :disabled="
            busy ||
            !speech.ready ||
            !speech.courseReady ||
            !speech.configuration.hasKey ||
            speech.configuration.mode !== 'ai'
          "
          @click="generate"
        >
          {{
            speech.courseAudio.complete
              ? "生成所选音色的整课音频"
              : "生成 / 继续整课音频"
          }}</button
        ><button
          class="button secondary compact"
          :disabled="busy || !speech.courseAudio.ready"
          @click="
            perform(async () => {
              await speech.play(speech.courseSpec.assets[0]!.text);
            })
          "
        >
          <Icon name="play" :size="17" />试听本课音频</button
        ><button
          class="text-button danger-text"
          :disabled="busy"
          @click="confirmReset = !confirmReset"
        >
          删除本课音频
        </button>
      </div>
      <div v-if="confirmReset" class="inline-note">
        <p>
          删除本课所有音色版本和未完成音频。模型配置、其他课程和学习记录保留。
        </p>
        <button
          class="button secondary compact"
          :disabled="busy || speech.courseGenerating"
          @click="
            authorize('删除本课音频', () =>
              perform(async () => {
                await speech.clearCourse();
                confirmReset = false;
                message = '本课音频已删除，可以重新生成。';
              }),
            )
          "
        >
          确认删除本课音频</button
        ><button class="text-button" @click="confirmReset = false">取消</button>
      </div>
    </template>
    <p v-if="speech.phase !== 'idle'">
      <button class="text-button" @click="speech.stop">停止播放</button>
    </p>
    <p v-if="message && !applicationNotices" class="inline-note" role="status">{{ message }}</p>
    <p v-if="error && !applicationNotices" class="inline-note speech-error" role="alert">
      {{ error }}
    </p>
  </section>
</template>
