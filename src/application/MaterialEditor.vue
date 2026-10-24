<script setup lang="ts">
import { computed, inject, onScopeDispose, ref } from "vue";
import type { MaterialCourse, MaterialInput } from "../../packages/learning-modes/catalog";
import { catalogKey } from "../platform/catalog";
import { contentNative } from "../platform/content";
import { createContentRequests } from "../platform/content-requests";
import SourceImages from "../components/SourceImages.vue";
import { materialRecognitionPrompt, parseMaterialRecognition } from "./material-recognition";
const props = defineProps<{
    material: MaterialCourse | null;
    authorize: (label: string, action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{
    saved: [
        id: string
    ];
}>();
const catalog = inject(catalogKey)!;
const draft = ref<MaterialInput>(props.material ? JSON.parse(JSON.stringify(props.material)) : { title: "", subtitle: "", sourceText: "", images: [], supplementImages: [] });
let id = props.material?.id ?? "", saved = JSON.stringify(draft.value), disposed = false;
const busy = ref(false), job = ref(false), error = ref(""), message = ref(""), replacement = ref("");
const recognizedMetadata = ref({ title: "", subtitle: "" });
const readonly = computed(() => !!props.material && (props.material.builtin || props.material.sourceEditable === false));
const requests = createContentRequests();
async function persist() {
    if (job.value || busy.value)
        throw Error("请先完成或暂停教材处理，再离开。");
    if (readonly.value || saved === JSON.stringify(draft.value))
        return;
    busy.value = true;
    error.value = "";
    try {
        const captured = JSON.parse(JSON.stringify(draft.value)) as MaterialInput;
        if (id)
            await catalog.updateMaterial(id, captured);
        else
            id = await catalog.createMaterial(captured);
        saved = JSON.stringify(captured);
        message.value = "教材已保存。";
        emit("saved", id);
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
        throw failure;
    }
    finally {
        busy.value = false;
    }
}
async function save() {
    try {
        await persist();
    }
    catch { }
}
async function pick(mode: "camera" | "gallery") {
    if (busy.value || job.value || draft.value.images.length >= 6)
        return;
    busy.value = true;
    error.value = "";
    try {
        const image = await contentNative.pickImage({ mode });
        if (!disposed && !image.cancelled)
            draft.value.images.push({ path: image.path, rotation: image.rotation });
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
    }
    finally {
        busy.value = false;
    }
}
async function recognize() {
    await props.authorize("识别课文图片", async () => {
        if (job.value || readonly.value)
            return;
        job.value = true;
        error.value = "";
        try {
            const result = parseMaterialRecognition(await requests.request("recognition", materialRecognitionPrompt, draft.value.images));
            if (disposed)
                return;
            recognizedMetadata.value = { title: result.title, subtitle: result.subtitle };
            if (!draft.value.title.trim())
                draft.value.title = result.title;
            if (!draft.value.subtitle.trim())
                draft.value.subtitle = result.subtitle;
            if (draft.value.sourceText.trim())
                replacement.value = result.text;
            else
                draft.value.sourceText = result.text;
        }
        catch (failure) {
            if (!disposed)
                error.value = failure instanceof Error ? failure.message : String(failure);
        }
        finally {
            job.value = false;
        }
    });
}
async function cancel() { await requests.cancel(); job.value = false; }
onScopeDispose(() => { disposed = true; void requests.dispose(); });
defineExpose({ prepareLeave: persist });
</script>

<template>
  <section class="shared-content material-editor">
    <h1>{{ material ? '课程教材' : '新建教材' }}</h1>
    <p>教材由各学习模式共用。保存后，可以分别准备七步学习或闯关内容。</p>
    <p v-if="readonly" class="frame-note">这份教材已经用于学习内容，当前版本保持只读。原有内容和记录继续保留。</p>
    <p v-if="error" role="alert" class="frame-error">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <section v-if="readonly">
      <h2>{{ draft.title }}</h2>
      <p>{{ draft.subtitle }}</p>
      <SourceImages :images="[...draft.images, ...draft.supplementImages]" />
      <p class="frame-source">{{ draft.sourceText }}</p>
    </section>
    <fieldset v-else :disabled="busy || job">
      <label for="material-title">课程标题</label>
      <input id="material-title" v-model="draft.title" maxlength="100" placeholder="例如：My Family" />
      <p v-if="recognizedMetadata.title && recognizedMetadata.title !== draft.title" class="frame-caption">
        图片识别标题：
        {{ recognizedMetadata.title }}
        <button type="button" class="frame-link" @click="draft.title = recognizedMetadata.title">采用识别标题</button>
      </p>
      <label for="material-subtitle">教材或单元（可选）</label>
      <input id="material-subtitle" v-model="draft.subtitle" maxlength="120" />
      <p v-if="recognizedMetadata.subtitle && recognizedMetadata.subtitle !== draft.subtitle" class="frame-caption">
        图片识别教材或单元：
        {{ recognizedMetadata.subtitle }}
        <button type="button" class="frame-link" @click="draft.subtitle = recognizedMetadata.subtitle">采用识别教材或单元</button>
      </p>
      <div class="frame-actions">
        <button type="button" @click="pick('camera')">拍摄课文</button>
        <button type="button" @click="pick('gallery')">选择课文图片</button>
      </div>
      <SourceImages
        :images="draft.images"
        :editable="!readonly"
        :disabled="busy || job"
        @change="draft.images = $event"
      />
      <button v-if="draft.images.length" type="button" @click="recognize">识别课文图片</button>
      <div v-if="replacement" class="frame-note">
        <label>
          新的识别结果
          <textarea v-model="replacement" rows="6" maxlength="6000" />
        </label>
        <button type="button" @click="draft.sourceText = replacement; replacement = ''">采用识别结果替换当前草稿</button>
        <button type="button" @click="replacement = ''">保留当前原文</button>
      </div>
      <label for="material-source">文章或课文原文</label>
      <textarea
        id="material-source"
        v-model="draft.sourceText"
        rows="10"
        maxlength="6000"
        placeholder="每段或话轮换行，对话可以使用 Alice: Hello! 的格式。"
      />
      <SourceImages v-if="draft.supplementImages.length" :images="draft.supplementImages" />
      <button type="button" class="frame-button" @click="save">保存教材</button>
    </fieldset>
    <button v-if="job" type="button" @click="cancel">暂停识别</button>
  </section>
</template>
