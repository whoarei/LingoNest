<script setup lang="ts">
import { computed, inject, onScopeDispose, ref } from "vue";
import { useWorkspace } from "../../../src/application/workspace";
import { catalogKey } from "../../../src/platform/catalog";
import { SnapshotRepository } from "../../../src/platform/snapshot-repository";
import CourseModeNotice from "../../../src/components/CourseModeNotice.vue";
const workspace = useWorkspace(), catalog = inject(catalogKey)!;
const ready = ref(false), busy = ref(false);
const selected = ref({ id: "", title: "" });
const statuses = ref<Record<string, "review" | "ready">>({});
const repository = new SnapshotRepository({ storageKey: "lingonest.test-adaptive.v1", empty: () => ({ statuses: {} as Record<string, "review" | "ready"> }), decode: payload => JSON.parse(payload) });
const status = computed<"missing" | "review" | "ready">(() => statuses.value[selected.value.id] ?? "missing");
async function refresh() {
  const directory = await catalog.read();
  const id = workspace.courseId.value ?? directory.learningCourseIds[directory.activeLearnerId ?? ""] ?? directory.defaultCourseId;
  selected.value = directory.courses.find(course => course.id === id) ?? { id, title: "测试课程" };
}
async function save(status: "review" | "ready") {
  busy.value = true;
  try { const next = { ...statuses.value, [selected.value.id]: status }; await repository.save({ statuses: next }); statuses.value = next; }
  finally { busy.value = false; }
}
onScopeDispose(workspace.connect({ get ready() { return ready.value; }, get busy() { return busy.value; }, focused: false,
  async prepareLeave() { if (busy.value) throw Error("正在保存测试模式。"); }, async handleBack() { return false; }, async exit() {}, refresh }));
void (async () => { statuses.value = (await repository.load()).statuses; await refresh(); ready.value = true; })();
</script>
<template>
  <main v-if="ready" class="frame-page test-adaptive-experience">
    <h1>测试自适应模式</h1><p>{{ selected.title }}</p>
    <template v-if="workspace.surface.value === 'authoring'">
      <button v-if="status === 'missing'" class="frame-button" @click="save('review')">模拟生成内容</button>
      <button v-if="status === 'review'" class="frame-button" @click="save('ready')">审核并开放测试内容</button>
      <p v-if="status === 'ready'">本课已审核，可以开始测试学习。</p>
    </template>
    <CourseModeNotice v-else-if="status !== 'ready'" :title="selected.title" mode-title="测试自适应模式" :status="status" @prepare="workspace.openParent('authoring')" />
    <p v-else role="status">本课已审核，可以开始测试学习。</p>
  </main>
</template>
