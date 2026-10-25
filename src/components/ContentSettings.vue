<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref } from "vue";
import {
  contentNative,
  type ContentKind,
  type ContentConfiguration,
} from "../platform/content";
import { isAndroid } from "../native";
import ApiKeyInput from "./ApiKeyInput.vue";
import Icon from "./AppIcon.vue";
const configuration = reactive<Record<ContentKind, ContentConfiguration>>({
  recognition: { baseUrl: "", model: "", hasKey: false },
  generation: { baseUrl: "", model: "", hasKey: false },
});
const keys = reactive({ recognition: "", generation: "" });
const busy = ref(isAndroid),
  testing = ref<ContentKind | null>(null),
  error = ref(""),
  confirmClear = ref<ContentKind | null>(null);
const labels = { recognition: "文字识别", generation: "课程生成" };
const descriptions = { recognition: "把教材图片转成可编辑的课文与词汇。", generation: "根据已确认的课文和词汇编排课程。" };
const saved = reactive({ recognition: "", generation: "" });
const checks = reactive<Record<ContentKind, "untested" | "passed" | "failed">>({ recognition: "untested", generation: "untested" });
const feedback = reactive<Record<ContentKind, { text: string; error: boolean } | null>>({ recognition: null, generation: null });
function snapshot(kind: ContentKind) {
  return JSON.stringify([configuration[kind].baseUrl, configuration[kind].model, configuration[kind].hasKey]);
}
function edited(kind: ContentKind) { checks[kind] = "untested"; feedback[kind] = null; }
function status(kind: ContentKind) {
  if (testing.value === kind) return { label: "测试中…", tone: "pending" };
  if (keys[kind] || saved[kind] && snapshot(kind) !== saved[kind]) return { label: "待保存", tone: "pending" };
  if (checks[kind] === "passed") return { label: "测试通过", tone: "success" };
  if (checks[kind] === "failed") return { label: "测试未通过", tone: "error" };
  return { label: configuration[kind].hasKey ? "已保存 · 待测试" : "尚未配置", tone: "neutral" };
}
let disposed = false;
onMounted(async () => {
  if (isAndroid)
    try {
      Object.assign(configuration, await contentNative.getConfig());
      for (const kind of ["recognition", "generation"] as const) saved[kind] = snapshot(kind);
    } catch {
      error.value = "内容模型配置暂时无法读取，请重试。";
    } finally {
      busy.value = false;
    }
});
onBeforeUnmount(() => {
  disposed = true;
  if (testing.value) void contentNative.cancelRequest().catch(() => {});
  keys.recognition = "";
  keys.generation = "";
});
async function save(kind: ContentKind, test = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  feedback[kind] = null;
  checks[kind] = "untested";
  try {
    configuration[kind] = await contentNative.saveConfig({
      kind,
      baseUrl: configuration[kind].baseUrl,
      model: configuration[kind].model,
      apiKey: keys[kind],
    });
    keys[kind] = "";
    saved[kind] = snapshot(kind);
    if (disposed) return;
    if (test) {
      testing.value = kind;
      await contentNative.testConfig({ kind });
      if (!disposed) {
        checks[kind] = "passed";
        feedback[kind] = { text: `${labels[kind]}测试通过，配置已保存。`, error: false };
      }
    } else feedback[kind] = { text: `${labels[kind]}配置已保存，尚未测试。`, error: false };
  } catch (failure) {
    if (!disposed) {
      const reason = failure instanceof Error ? failure.message : String(failure);
      if (testing.value) checks[kind] = "failed";
      feedback[kind] = { error: true, text: testing.value
        ? `${labels[kind]}测试失败：${reason} 配置已保存，可修改后重新测试。`
        : reason };
    }
  } finally {
    testing.value = null;
    busy.value = false;
  }
}
async function clear(kind: ContentKind) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  feedback[kind] = null;
  try {
    await contentNative.clearConfig({ kind });
    configuration[kind] = { baseUrl: "", model: "", hasKey: false };
    keys[kind] = "";
    saved[kind] = snapshot(kind);
    checks[kind] = "untested";
    confirmClear.value = null;
    feedback[kind] = { text: `${labels[kind]}配置已移除，课程和草稿保留。`, error: false };
  } catch {
    feedback[kind] = { text: "配置移除失败，请重试。", error: true };
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="section-panel content-settings" aria-labelledby="content-settings-title">
    <div class="section-heading model-settings-heading">
      <span class="model-settings-icon"><Icon name="light" :size="22" /></span>
      <div>
        <h2 id="content-settings-title">识别与课程生成模型</h2>
        <p class="field-help">
          为教材识别和课程编排分别配置模型，保存后即可测试。
        </p>
      </div>
    </div>
    <p v-if="!isAndroid" class="inline-note">
      请在 Android 应用中保存模型配置。
    </p>
    <p v-if="error" role="alert" class="inline-note speech-error">{{ error }}</p>
    <div class="content-config-grid">
      <form
        v-for="(label, kind) in labels"
        :key="kind"
        class="model-config-card"
        :aria-labelledby="`content-card-${kind}`"
        @submit.prevent="save(kind, true)"
      >
        <fieldset :disabled="busy || !isAndroid" class="speech-fields">
          <div class="model-config-heading">
            <h3 :id="`content-card-${kind}`">{{ label }}</h3>
            <span class="model-config-status" :class="status(kind).tone">{{ status(kind).label }}</span>
          </div>
          <p class="model-config-description">{{ descriptions[kind] }}</p>
          <label :for="`content-url-${kind}`">服务地址</label
          ><input
            :id="`content-url-${kind}`"
            :aria-label="`${label}服务地址`"
            v-model.trim="configuration[kind].baseUrl"
            @input="edited(kind)"
            :aria-describedby="`content-url-help-${kind}`"
            type="url"
            placeholder="https://api.example.com/v1"
            autocomplete="off"
            autocapitalize="none"
            :spellcheck="false"
            required
          />
          <p :id="`content-url-help-${kind}`" class="model-field-help">填写 HTTPS Base URL，例如以 /v1 结尾的地址。</p>
          <label :for="`content-model-${kind}`">模型</label
          ><input
            :id="`content-model-${kind}`"
            :aria-label="`${label}模型`"
            v-model.trim="configuration[kind].model"
            @input="edited(kind)"
            placeholder="填写服务提供的模型名称"
            autocomplete="off"
            autocapitalize="none"
            :spellcheck="false"
            required
          />
          <label :for="`content-key-${kind}`">API Key</label
          ><ApiKeyInput
            :id="`content-key-${kind}`"
            v-model="keys[kind]"
            @update:model-value="edited(kind)"
            :label="`${label} API Key`"
            :input-label="`${label} API Key`"
            :placeholder="
              configuration[kind].hasKey
                ? '已保存，留空沿用'
                : '填写 API Key'
            "
          />
          <p class="model-field-help">
            {{ kind === 'recognition' ? '需支持图片输入。' : '需支持结构化文本输出。' }}更换服务域名时需重新填写 Key。
          </p>
          <div class="speech-actions model-config-actions">
            <button class="button primary compact" :aria-label="testing === kind ? '测试中…' : `保存并测试${label}`">
              <Icon :name="testing === kind ? 'clock' : 'play'" :size="16" />
              {{ testing === kind ? '测试中…' : '保存并测试' }}
            </button>
            <button class="button secondary compact" type="button" :aria-label="`仅保存${label}配置`" @click="save(kind)">
              仅保存
            </button>
          </div>
          <p class="model-field-help model-test-help">测试使用内置{{ kind === 'recognition' ? '示例图片' : '文本示例' }}，可能消耗少量额度。</p>
          <p v-if="testing === kind" role="status" class="model-config-feedback">
            正在验证{{ label }}模型，请稍候…
          </p>
          <p v-else-if="feedback[kind]" :role="feedback[kind]!.error ? 'alert' : 'status'" class="model-config-feedback" :class="feedback[kind]!.error ? 'error' : 'success'">
            {{ feedback[kind]!.text }}
          </p>
          <div class="model-config-maintenance">
            <button
              class="text-button danger-text"
              type="button"
              :aria-label="`移除${label}配置`"
              @click="confirmClear = kind"
            >
              <Icon name="trash" :size="16" />移除配置
            </button>
          </div>
          <div v-if="confirmClear === kind" class="inline-note">
            <p>只移除本机模型与 Key，课程、图片、草稿和学习记录保留。</p>
            <button type="button" class="text-button" @click="clear(kind)">
              确认移除{{ label }}配置</button
            ><button
              type="button"
              class="text-button"
              @click="confirmClear = null"
            >
              取消
            </button>
          </div>
        </fieldset>
      </form>
    </div>
    <details class="model-config-help">
      <summary>服务地址与数据使用说明</summary>
      <p>使用兼容 Chat Completions 的服务，填写 Base URL，无需加上 /chat/completions。API Key 加密保存在本机，留空可保留已保存的 Key。</p>
      <p>识别或生成时，所选教材图片或课文会发送至该服务，孩子的录音和学习记录不发送。测试通过后，实际教材仍可能受长度或内容限制。</p>
    </details>
  </section>
</template>
