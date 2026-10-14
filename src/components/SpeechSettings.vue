<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type UnwrapNestedRefs,
} from "vue";
import type { SpeechController } from "../useSpeech";
import { speechVoices, speechSample, type SpeechInput } from "../speech-types";
import Icon from "./AppIcon.vue";
const props = defineProps<{ speech: UnwrapNestedRefs<SpeechController> }>();
const form = reactive<SpeechInput>({ ...props.speech.configuration });
const apiKey = ref(""),
  customVoice = ref(false),
  busy = ref(false),
  message = ref(""),
  error = ref(""),
  confirmReset = ref(false),
  confirmCourseReset = ref(false);
const voices = computed(() => speechVoices[form.protocol]);
watch(
  () => form.protocol,
  (protocol) => {
    if (
      !customVoice.value &&
      !speechVoices[protocol].some((v) => v.id === form.voice)
    )
      form.voice = speechVoices[protocol][0]!.id;
  },
);
watch(
  () => props.speech.configuration,
  (value) => {
    Object.assign(form, value);
    customVoice.value = !speechVoices[value.protocol].some(
      (v) => v.id === value.voice,
    );
  },
  { immediate: true },
);
function preset(protocol: SpeechInput["protocol"]) {
  form.mode = "ai";
  form.protocol = protocol;
  customVoice.value = false;
  form.baseUrl =
    protocol === "mimo-chat"
      ? "https://api.xiaomimimo.com/v1"
      : "https://api.openai.com/v1";
  form.model = protocol === "mimo-chat" ? "mimo-v2.5-tts" : "gpt-4o-mini-tts";
  form.voice = protocol === "mimo-chat" ? "Chloe" : "alloy";
  form.speed = 0.9;
  form.instructions =
    protocol === "mimo-chat"
      ? "Read the exact English text clearly and naturally, like a warm English teacher. Do not add or change words."
      : "";
}
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
async function persist() {
  await props.speech.save({
    mode: form.mode,
    protocol: form.protocol,
    baseUrl: form.baseUrl,
    model: form.model,
    voice: form.voice,
    speed: form.speed,
    instructions: form.instructions,
    apiKey: apiKey.value,
  });
  apiKey.value = "";
}
async function save(test = false) {
  await perform(async () => {
    await persist();
    if (test) {
      const played = await props.speech.preview(speechSample);
      await props.speech.refreshCache();
      message.value = played
        ? "试听完成。生成整课后才会采用这套新音色。"
        : "试听已停止，配置已保存。";
    } else message.value = "朗读设置已保存。";
  });
}
async function generateCourse() {
  await perform(async () => {
    await persist();
    const completed = await props.speech.generateCourse();
    message.value = completed
      ? "整课音频已保存为课程资源，可以反复离线学习。"
      : "生成已暂停，已完成部分保留，下次可以继续。";
  });
}
onBeforeUnmount(() => {
  apiKey.value = "";
});
</script>

<template>
  <section class="speech-settings" aria-labelledby="speech-title">
    <div class="section-heading">
      <div>
        <h3 id="speech-title">课文朗读</h3>
        <p>已保存的课程音频可长期离线播放。选择新音色后，先试听再生成整课。</p>
      </div>
      <Icon name="volume" :size="23" />
    </div>
    <p v-if="!speech.supported" class="inline-note">
      浏览器用于文字练习预览。AI 语音设置请在 Android 应用中使用。
    </p>
    <p v-if="speech.settingsError" class="inline-note" role="alert">
      {{ speech.settingsError }}
    </p>
    <form @submit.prevent="save(false)">
      <fieldset
        :disabled="
          busy || speech.courseGenerating || !speech.supported || !speech.ready
        "
        class="speech-fields"
      >
        <label for="speech-mode">朗读方式</label>
        <select id="speech-mode" v-model="form.mode">
          <option value="device">设备离线朗读</option>
          <option value="ai">AI 语音合成</option>
        </select>
        <p class="field-help">
          学习优先播放已生成的课程音频。此处配置用于试听和生成新版本，语速直接用于课程播放。
        </p>
        <template v-if="form.mode === 'ai'">
          <div class="speech-presets">
            <button
              type="button"
              class="button secondary compact"
              @click="preset('mimo-chat')"
            >
              小米 MiMo 配置</button
            ><button
              type="button"
              class="button secondary compact"
              @click="preset('openai-speech')"
            >
              OpenAI 配置
            </button>
          </div>
          <label for="speech-protocol">接口类型</label
          ><select id="speech-protocol" v-model="form.protocol">
            <option value="openai-speech">OpenAI 兼容语音接口</option>
            <option value="mimo-chat">小米 MiMo 语音接口</option>
          </select>
          <label for="speech-base-url">服务 Base URL</label
          ><input
            id="speech-base-url"
            v-model.trim="form.baseUrl"
            type="url"
            placeholder="https://api.example.com/v1"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            required
          />
          <label for="speech-model">语音模型</label
          ><input
            id="speech-model"
            v-model.trim="form.model"
            placeholder="填写服务提供的语音模型名称"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            required
          />
          <label for="speech-key">API Key</label
          ><input
            id="speech-key"
            v-model="apiKey"
            type="password"
            :placeholder="
              speech.configuration.hasKey
                ? '已保存；留空保留当前 Key'
                : '仅保存在此设备'
            "
            autocomplete="new-password"
            autocapitalize="none"
            spellcheck="false"
          />
          <p class="field-help">
            Key 加密保存在本机。更换服务域名时需要重新填写。
          </p>
          <label for="speech-voice">音色</label
          ><select v-if="!customVoice" id="speech-voice" v-model="form.voice">
            <option v-for="voice in voices" :key="voice.id" :value="voice.id">
              {{ voice.label }}
            </option>
          </select>
          <input
            v-else
            id="speech-voice"
            v-model.trim="form.voice"
            placeholder="填写服务商的音色名称"
            autocomplete="off"
            spellcheck="false"
            required
          />
          <label class="checkbox-label"
            ><input
              v-model="customVoice"
              type="checkbox"
            />使用自定义音色名称</label
          >
        </template>
        <label for="speech-speed"
          >语速 · {{ Number(form.speed).toFixed(2) }}×</label
        ><input
          id="speech-speed"
          v-model.number="form.speed"
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
        />
        <div class="speech-speed-buttons">
          <button
            v-for="speed in [0.75, 0.9, 1, 1.25]"
            :key="speed"
            type="button"
            class="button secondary compact"
            @click="form.speed = speed"
          >
            {{ speed }}×
          </button>
        </div>
        <p class="field-help">
          慢一些听清词句，熟悉后再恢复正常速度。AI
          音频在播放时调整速度，不会为变速重复生成。
        </p>
        <template v-if="form.mode === 'ai'"
          ><label for="speech-instructions">朗读风格（可选）</label
          ><textarea
            id="speech-instructions"
            v-model="form.instructions"
            rows="3"
            maxlength="2000"
            placeholder="例如：清楚、自然、温暖的英语教学朗读"
          />
          <p class="field-help">
            OpenAI 兼容服务需模型支持风格指令；不支持时请留空。
          </p>
          <p class="quiet-note">
            AI
            合成语音。首次试听或生成会将朗读文字发送到你配置的服务；整课生成后成为课程资源。音色、模型或风格变化需要明确重新生成，原课程音频保留到新版本完成。
          </p></template
        >
        <div class="speech-actions">
          <button class="button primary compact" type="submit">保存配置</button
          ><button
            class="button secondary compact"
            type="button"
            @click="save(true)"
          >
            <Icon name="play" :size="17" />保存并试听
          </button>
        </div>
      </fieldset>
    </form>
    <button
      v-if="speech.phase !== 'idle'"
      class="button secondary compact"
      type="button"
      @click="speech.stop"
    >
      {{ speech.phase === "generating" ? "取消语音生成" : "停止播放" }}
    </button>
    <p v-if="message" class="inline-note" role="status">{{ message }}</p>
    <p v-if="error" class="inline-note speech-error" role="alert">
      {{ error }}
    </p>
    <div v-if="speech.supported" class="speech-cache">
      <section class="course-audio-panel" aria-labelledby="course-audio-title">
        <h4 id="course-audio-title">本课音频资源 · {{ speech.courseTitle }}</h4>
        <p v-if="speech.courseReady">
          {{ speech.courseAudio.ready }} /
          {{ speech.courseAudio.total }} 段已就绪 ·
          {{ (speech.courseAudio.bytes / 1024 / 1024).toFixed(1) }} MB<span
            v-if="speech.courseAudio.voice"
          >
            · {{ speech.courseAudio.voice }}</span
          >
        </p>
        <p v-else>{{ speech.courseError || "正在检查课程音频…" }}</p>
        <p class="field-help">
          随课程长期保存，清理试听缓存、移除 Key 或切换学习档案都不会删除。APK
          不预装音频，请先配置服务，再生成整课。
        </p>
        <p
          v-if="speech.courseReady && speech.courseAudio.ready === 0"
          class="inline-note"
        >
          本课尚未生成音频。填写 API 和音色后，点击“生成 / 继续整课音频”。
        </p>
        <p v-if="speech.courseAudio.pending" class="inline-note">
          新音色 {{ speech.courseAudio.pending.voice }}：{{
            speech.courseAudio.pending.ready
          }}
          /
          {{ speech.courseAudio.pending.total }} 段。完成前继续使用原课程音频。
        </p>
        <div v-if="speech.courseGenerating" role="status">
          <p>
            正在生成课程音频 {{ speech.courseProgress.completed }} /
            {{ speech.courseProgress.total }}
          </p>
          <progress
            :value="speech.courseProgress.completed"
            :max="speech.courseProgress.total"
          /><button
            class="button secondary compact"
            type="button"
            @click="speech.cancelCourse"
          >
            暂停生成
          </button>
        </div>
        <template v-else>
          <button
            class="button primary compact"
            type="button"
            :disabled="
              busy || !speech.ready || !speech.courseReady || form.mode !== 'ai'
            "
            @click="generateCourse"
          >
            {{
              speech.courseAudio.complete
                ? "生成所选音色的整课音频"
                : "生成 / 继续整课音频"
            }}
          </button>
          <p class="field-help">
            按当前填写的设置保存并生成；仅请求缺失音频，失败或暂停后可继续。学习时不自动调用
            API。
          </p>
          <button
            class="text-button"
            type="button"
            :disabled="busy"
            @click="confirmCourseReset = !confirmCourseReset"
          >
            删除本课音频
          </button>
        </template>
        <div v-if="confirmCourseReset" class="inline-note">
          <p>
            删除本课所有已生成的音色版本。再次使用 AI 音频需要重新生成；API
            配置和学习记录保留。
          </p>
          <button
            class="button secondary compact"
            type="button"
            :disabled="busy || speech.courseGenerating"
            @click="
              perform(async () => {
                await speech.clearCourse();
                confirmCourseReset = false;
                message = '本课音频已删除，可以重新测试生成。';
              })
            "
          >
            确认删除本课音频
          </button>
        </div>
      </section>
      <p>
        试听缓存：{{ speech.cache.count }} 段 ·
        {{ (speech.cache.bytes / 1024 / 1024).toFixed(1) }} MB
      </p>
      <button
        class="text-button"
        type="button"
        :disabled="busy || speech.courseGenerating"
        @click="
          perform(async () => {
            await speech.clearCache();
            message = '试听缓存已清理，课程音频和学习记录保留。';
          })
        "
      >
        清理试听缓存</button
      ><button
        class="text-button danger-text"
        type="button"
        :disabled="busy || speech.courseGenerating"
        @click="confirmReset = !confirmReset"
      >
        移除 API 配置
      </button>
    </div>
    <div v-if="confirmReset" class="inline-note">
      <p>
        移除本机保存的服务配置和
        Key。课程音频保留，仍可离线学习；尚未生成的内容使用设备朗读。
      </p>
      <button
        type="button"
        class="button secondary compact"
        :disabled="busy"
        @click="
          perform(async () => {
            await speech.reset();
            apiKey = '';
            confirmReset = false;
            message = '已移除 API 配置。';
          })
        "
      >
        确认移除
      </button>
    </div>
  </section>
</template>
