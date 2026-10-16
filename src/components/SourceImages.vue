<script setup lang="ts">
import { ref, watch } from "vue";
import type { SourceImage } from "../../packages/learning-modes/contracts";
import { imageSource } from "../platform/content";
import Icon from "./AppIcon.vue";
const props = defineProps<{
  images: SourceImage[];
  editable?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [images: SourceImage[]] }>();
const urls = ref<Record<string, string>>({}),
  errors = ref<string[]>([]),
  preview = ref<SourceImage | null>(null);
let epoch = 0;
watch(
  () => props.images.map((image) => image.path).join("|"),
  async () => {
    const token = ++epoch;
    const results = await Promise.allSettled(
      props.images.map(
        async (image) => [image.path, await imageSource(image)] as const,
      ),
    );
    if (token !== epoch) return;
    urls.value = {};
    errors.value = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled")
        urls.value[result.value[0]] = result.value[1];
      else errors.value.push(props.images[index]!.path);
    });
  },
  { immediate: true },
);
function rotate(index: number) {
  emit(
    "change",
    props.images.map((image, i) =>
      i === index
        ? {
            ...image,
            rotation: ((image.rotation + 90) % 360) as SourceImage["rotation"],
          }
        : image,
    ),
  );
}
function move(index: number, delta: number) {
  const list = [...props.images];
  [list[index], list[index + delta]] = [list[index + delta]!, list[index]!];
  emit("change", list);
}
</script>
<template>
  <div v-if="images.length" class="course-source-grid">
    <article v-for="(image, index) in images" :key="image.path">
      <button
        class="course-image-preview"
        :aria-label="`放大课文原图 ${index + 1}`"
        :disabled="!urls[image.path]"
        @click="preview = image"
      >
        <img
          v-if="urls[image.path]"
          :src="urls[image.path]"
          :style="{ transform: `rotate(${image.rotation}deg)` }"
          :alt="`原图 ${index + 1}`"
        /><span v-else>{{
          errors.includes(image.path)
            ? "图片不可读取，请重新添加"
            : "正在读取图片…"
        }}</span>
      </button>
      <small>原图 {{ index + 1 }}</small>
      <div v-if="editable" class="course-image-actions">
        <button class="text-button" :disabled="disabled" @click="rotate(index)">
          旋转</button
        ><button
          class="text-button"
          :disabled="disabled || index === 0"
          @click="move(index, -1)"
        >
          前移</button
        ><button
          class="text-button"
          :disabled="disabled || index === images.length - 1"
          @click="move(index, 1)"
        >
          后移</button
        ><button
          class="text-button danger-text"
          :disabled="disabled"
          @click="
            emit(
              'change',
              images.filter((_, i) => i !== index),
            )
          "
        >
          移除
        </button>
      </div>
    </article>
  </div>
  <div
    v-if="preview"
    class="modal-backdrop image-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="课文原图"
    @click.self="preview = null"
  >
    <button
      class="image-close icon-button"
      aria-label="关闭原图"
      @click="preview = null"
    >
      <Icon name="close" :size="24" /></button
    ><img
      :src="urls[preview.path]"
      :style="{
        transform: `rotate(${preview.rotation}deg)`,
        maxWidth: preview.rotation % 180 ? '80vh' : '90vw',
        maxHeight: preview.rotation % 180 ? '85vw' : '85vh',
      }"
      alt="放大的课文原图，请对照校对"
    />
  </div>
</template>
