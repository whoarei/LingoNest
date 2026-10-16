<script setup lang="ts">
import { computed, defineAsyncComponent, ref, onErrorCaptured, provide, watch, type Component } from "vue";
import { teachingModes } from "./registry";
import { createModeSelection, modeSelectionKey } from "../platform/mode-selection";
import ParentModeSettings from "../components/ParentModeSettings.vue";

const selection = createModeSelection(teachingModes.modes, teachingModes.defaultModeId);
provide(modeSelectionKey, selection);
const failure = ref("");
const experiences = new Map<string, Component>();
const registration = computed(() => teachingModes.modes.find(mode => mode.identity.id === selection.activeModeId.value));
const Experience = computed(() => {
  const mode = registration.value;
  if (!mode) return null;
  if (!experiences.has(mode.identity.id)) experiences.set(mode.identity.id, defineAsyncComponent(mode.loadExperience));
  return experiences.get(mode.identity.id)!;
});
watch(selection.activeModeId, () => { failure.value = ""; });
void selection.load().catch(() => {});
function reload() { window.location.reload(); }
function blockWhileSwitching(event: Event) {
  if (selection.busy.value) { event.preventDefault(); event.stopImmediatePropagation(); }
}
onErrorCaptured((error) => {
  failure.value = error instanceof Error ? error.message : String(error);
  return false;
});
</script>

<template>
  <main v-if="!selection.ready.value" class="mode-host-message" :role="selection.error.value ? 'alert' : 'status'">
    <h1>{{ selection.error.value ? '无法读取课程模式设置' : '正在载入课程模式…' }}</h1>
    <p>{{ selection.error.value }}</p>
    <p>已有课程与学习记录保留。</p>
    <button v-if="selection.error.value" @click="reload">重新打开</button>
  </main>
  <main v-else-if="failure || !Experience" class="mode-host-message">
    <h1>学习模式暂时无法加载</h1>
    <p role="alert">{{ failure || '当前课程模式尚未安装，请家长选择已安装的模式。' }}</p>
    <p>已有课程与学习记录保留，不会自动切换到其他模式。</p>
    <ParentModeSettings />
    <button @click="reload">重新打开</button>
  </main>
  <div v-else :aria-busy="selection.busy.value" @click.capture="blockWhileSwitching" @keydown.capture="blockWhileSwitching">
    <component :is="Experience" :key="selection.activeModeId.value" />
  </div>
  <div v-if="selection.busy.value" class="mode-host-busy" role="status">正在保存进度并切换模式…</div>
</template>

<style scoped>
main {
  max-width: 42rem;
  margin: 3rem auto;
  padding: 1.5rem;
  font: 16px/1.6 system-ui, sans-serif;
}
.mode-host-busy {
  position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
  background: rgba(247, 248, 244, .92); color: #293e33; font: 16px/1.6 system-ui, sans-serif;
}
</style>
