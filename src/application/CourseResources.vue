<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { CourseAudioManifest } from "../../packages/learning-modes/contracts";
import { useSpeech } from "../platform/speech";
import CourseAudioPanel from "../components/CourseAudioPanel.vue";
const props = defineProps<{
    resources: {
        label: string;
        manifest: CourseAudioManifest;
    }[];
    authorize: (label: string, action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{
    settings: [
    ];
}>();
const selected = ref("");
const key = (manifest: CourseAudioManifest) => manifest.courseId + ":" + manifest.courseVersion;
const source = computed(() => props.resources.find(item => key(item.manifest) === selected.value)?.manifest ?? props.resources[0]?.manifest ?? { courseId: "empty-material", courseVersion: "1", title: "课程资源", assets: [] });
const speech = reactive(useSpeech(source));
defineExpose({
    get busy() { return speech.courseGenerating; },
    async prepareLeave() {
        if (speech.courseGenerating)
            throw Error("请先暂停当前音频生成。");
        await speech.stop();
    },
});
</script>

<template>
  <section class="shared-content course-resources">
    <h2>课程音频</h2>
    <p>按学习模式和内容版本分别准备，教材图片由课程共用。</p>
    <label v-if="resources.length > 1">
      内容版本
      <select
        :value="key(source)"
        :disabled="speech.courseGenerating"
        @change="selected = ($event.target as HTMLSelectElement).value"
      >
        <option v-for="item in resources" :key="key(item.manifest)" :value="key(item.manifest)">{{ item.label }}·{{ item.manifest.courseVersion }}</option>
      </select>
    </label>
    <CourseAudioPanel v-if="resources.length" :speech="speech" :authorize="authorize" @settings="emit('settings')" />
    <p v-else class="frame-note">先准备学习内容，之后在这里生成对应音频。</p>
  </section>
</template>
