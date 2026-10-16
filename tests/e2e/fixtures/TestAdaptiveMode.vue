<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useModeSelection } from "../../../src/platform/mode-selection";
import { SnapshotRepository } from "../../../src/platform/snapshot-repository";
import { courseModeAccess, type CourseModeStatus } from "../../../packages/learning-modes/availability";
import CourseModeNotice from "../../../src/components/CourseModeNotice.vue";
import ParentModeSettings from "../../../src/components/ParentModeSettings.vue";
const selection = useModeSelection();
const courses = (window as unknown as { __fixtureCourses: { id: string; title: string }[] }).__fixtureCourses;
const selected = ref(courses[0]!);
const statuses = ref<Record<string, "review" | "ready">>({});
const parent = ref(false), preparing = ref(false), ready = ref(false);
const repository = new SnapshotRepository({
  storageKey: "lingonest.test-adaptive.v1",
  empty: () => ({ statuses: {} as Record<string, "review" | "ready"> }),
  decode: (payload: string) => JSON.parse(payload) as { statuses: Record<string, "review" | "ready"> },
});
onMounted(async () => { statuses.value = (await repository.load()).statuses; ready.value = true; });
const access = computed(() => courseModeAccess(selection.activeModeId.value, statuses.value[selected.value.id]
  ? [{ modeId: "test-adaptive", status: statuses.value[selected.value.id]! }] : []));
async function save(status: Exclude<CourseModeStatus, "draft" | "missing">) {
  const next = { ...statuses.value, [selected.value.id]: status };
  await repository.save({ statuses: next }); statuses.value = next;
}
</script>
<template>
  <main v-if="ready" class="test-adaptive-experience">
    <h1>测试自适应模式</h1>
    <nav aria-label="测试课程选择">
      <button v-for="course in courses" :key="course.id" @click="selected = course; preparing = false">{{ course.title }}</button>
    </nav>
    <CourseModeNotice v-if="!access.canLearn" :title="selected.title" mode-title="测试自适应模式" :status="access.status" @prepare="parent = true; preparing = true" />
    <p v-else role="status">本课已审核，可以开始测试学习。</p>
    <section v-if="preparing" aria-label="测试模式准备流程">
      <button v-if="access.status === 'missing'" @click="save('review')">模拟生成内容</button>
      <button v-if="access.status === 'review'" @click="save('ready')">审核并开放测试内容</button>
    </section>
    <button @click="parent = !parent">家长空间</button>
    <ParentModeSettings v-if="parent" />
  </main>
</template>
