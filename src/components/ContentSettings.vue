<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref } from "vue";
import {
  contentNative,
  type ContentKind,
  type ContentConfiguration,
} from "../platform/content";
import { isAndroid } from "../native";
import { useOperationNotices } from "../platform/notifications";
const configuration = reactive<Record<ContentKind, ContentConfiguration>>({
  recognition: { baseUrl: "", model: "", hasKey: false },
  generation: { baseUrl: "", model: "", hasKey: false },
});
const keys = reactive({ recognition: "", generation: "" });
const busy = ref(isAndroid),
  error = ref(""),
  message = ref(""),
  confirmClear = ref<ContentKind | null>(null);
const applicationNotices = useOperationNotices(message, error);
const labels = { recognition: "文字识别", generation: "课程生成" };
onMounted(async () => {
  if (isAndroid)
    try {
      Object.assign(configuration, await contentNative.getConfig());
    } catch {
      error.value = "内容模型配置暂时无法读取，请重试。";
    } finally {
      busy.value = false;
    }
});
onBeforeUnmount(() => {
  keys.recognition = "";
  keys.generation = "";
});
async function save(kind: ContentKind) {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    configuration[kind] = await contentNative.saveConfig({
      kind,
      baseUrl: configuration[kind].baseUrl,
      model: configuration[kind].model,
      apiKey: keys[kind],
    });
    keys[kind] = "";
    message.value = `${labels[kind]}配置已保存。`;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
async function clear(kind: ContentKind) {
  busy.value = true;
  error.value = "";
  try {
    await contentNative.clearConfig({ kind });
    configuration[kind] = { baseUrl: "", model: "", hasKey: false };
    keys[kind] = "";
    confirmClear.value = null;
    message.value = `${labels[kind]}配置已移除，课程和草稿保留。`;
  } catch {
    error.value = "配置移除失败，请重试。";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="section-panel content-settings">
    <div class="section-heading">
      <div>
        <h2>识别与课程生成模型</h2>
        <p class="field-help">
          使用兼容 Chat Completions
          的服务。文字识别需要支持图片输入的模型，课程生成需要文字模型。
        </p>
      </div>
    </div>
    <p v-if="!isAndroid" class="inline-note">
      请在 Android 应用中保存模型配置。
    </p>
    <div class="content-config-grid">
      <form
        v-for="(label, kind) in labels"
        :key="kind"
        @submit.prevent="save(kind)"
      >
        <fieldset :disabled="busy || !isAndroid" class="speech-fields">
          <h3>{{ label }}</h3>
          <label :for="`content-url-${kind}`">{{ label }}服务地址</label
          ><input
            :id="`content-url-${kind}`"
            v-model.trim="configuration[kind].baseUrl"
            type="url"
            placeholder="https://api.example.com/v1"
            autocomplete="off"
            autocapitalize="none"
            :spellcheck="false"
            required
          />
          <label :for="`content-model-${kind}`">{{ label }}模型</label
          ><input
            :id="`content-model-${kind}`"
            v-model.trim="configuration[kind].model"
            placeholder="填写服务提供的模型名称"
            autocomplete="off"
            autocapitalize="none"
            :spellcheck="false"
            required
          />
          <label :for="`content-key-${kind}`">{{ label }} API Key</label
          ><input
            :id="`content-key-${kind}`"
            v-model="keys[kind]"
            type="password"
            :placeholder="
              configuration[kind].hasKey
                ? '已保存；留空保留当前 Key'
                : '仅加密保存在此设备'
            "
            autocomplete="new-password"
            autocapitalize="none"
            :spellcheck="false"
          />
          <p class="field-help">
            更换服务域名需重新填写
            Key。识别或生成时会将所选教材图片或课文发送至该服务，孩子的录音和学习记录不发送。
          </p>
          <div class="speech-actions">
            <button class="button primary compact">保存{{ label }}配置</button
            ><button
              class="text-button"
              type="button"
              @click="confirmClear = kind"
            >
              移除{{ label }}配置
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
    <p v-if="error && !applicationNotices" role="alert" class="inline-note speech-error">
      {{ error }}
    </p>
    <p v-if="message && !applicationNotices" role="status" class="inline-note">{{ message }}</p>
  </section>
</template>
