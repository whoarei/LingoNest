<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type UnwrapNestedRefs,
} from "vue";
import type { SpeechController } from "../platform/speech";
import { speechVoices, speechSample, type SpeechInput } from "../speech-types";
import Icon from "./AppIcon.vue";
import ApiKeyInput from "./ApiKeyInput.vue";
const props = defineProps<{ speech: UnwrapNestedRefs<SpeechController> }>();
const form = reactive<SpeechInput>({ ...props.speech.configuration });
const apiKey = ref(""),
  customVoice = ref(false),
  busy = ref(false),
  message = ref(""),
  error = ref(""),
  confirmReset = ref(false);
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
onBeforeUnmount(() => {
  apiKey.value = "";
});
</script>

<template>
  <section class="speech-settings" aria-labelledby="speech-title">
    <div class="section-heading model-settings-heading">
      <span class="model-settings-icon"><Icon name="volume" :size="22" /></span>
      <div>
        <h2 id="speech-title">语音模型与朗读配置</h2>
        <p>
          连接语音服务、选择音色，保存后先听一听。
        </p>
      </div>
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
        class="speech-fields model-speech-grid"
      >
        <div class="model-config-card">
          <h3>语音服务</h3>
          <p class="model-config-description">选择设备朗读，或连接自己的 AI 语音服务。</p>
        <label for="speech-mode">朗读方式</label>
        <select id="speech-mode" v-model="form.mode">
          <option value="device">设备离线朗读</option>
          <option value="ai">AI 语音合成</option>
        </select>
        <p class="field-help">
          学习时优先播放已准备的课程音频。
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
          ><ApiKeyInput
            id="speech-key"
            v-model="apiKey"
            label="语音 API Key"
            :placeholder="
              speech.configuration.hasKey
                ? '已保存，留空沿用'
                : '填写 API Key'
            "
          />
          <p class="field-help">
            Key 加密保存在本机。更换服务域名时需要重新填写。
          </p>
        </template>
        </div>
        <div class="model-config-card">
          <h3>音色与播放</h3>
          <p class="model-config-description">{{ form.mode === 'ai' ? '先选音色，再调整适合孩子的朗读速度。' : '设备朗读使用系统音色，可调整朗读速度。' }}</p>
        <template v-if="form.mode === 'ai'">
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
            :aria-pressed="Number(form.speed) === speed"
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
        </template>
        </div>
        <div class="speech-actions model-speech-actions">
          <button class="button secondary compact" type="submit">保存配置</button
          ><button
            class="button primary compact"
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
    <p v-if="message" class="model-config-feedback success" role="status">{{ message }}</p>
    <p v-if="error" class="model-config-feedback error" role="alert">
      {{ error }}
    </p>
    <details class="model-config-help">
      <summary>试听与课程音频说明</summary>
      <p>试听或生成会将朗读文字发送到配置的服务。整课音频请在课程管理中准备，生成后可反复离线学习。</p>
      <p>更换音色、模型或朗读风格后，需重新生成课程音频；原音频保留到新版本完成。语速直接用于播放，无需重复生成。</p>
    </details>
    <div v-if="speech.supported" class="speech-cache">
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
