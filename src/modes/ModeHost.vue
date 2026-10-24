<script setup lang="ts">
import { computed, defineAsyncComponent, onErrorCaptured, provide, shallowRef, toRef, watch, type Component } from "vue";
import { teachingModes } from "./registry";
import { workspaceKey, type ModeSurface, type ModeWorkspace } from "../application/workspace";
const props = defineProps<{
    modeId: string;
    surface: ModeSurface;
    courseId: string | null;
    visible: boolean;
    parent: boolean;
    activation: number;
    authorize: (label: string, action: () => Promise<void>) => Promise<void>;
    openParent: (surface?: ModeSurface) => Promise<void>;
    openSettings: () => Promise<void>;
    editMaterial: () => Promise<void>;
    notify: (message: string, kind?: "error" | "status") => void;
}>();
const failure = shallowRef("");
const adapter = shallowRef<ModeWorkspace | null>(null);
const retry = shallowRef(0);
const experiences = new Map<string, Component>();
const Experience = computed(() => {
    const mode = teachingModes.modes.find(mode => mode.identity.id === props.modeId);
    if (!mode)
        return null;
    const key = mode.identity.id + ":" + retry.value;
    if (!experiences.has(key))
        experiences.set(key, defineAsyncComponent(mode.loadExperience));
    return experiences.get(key)!;
});
provide(workspaceKey, {
    modeId: toRef(props, "modeId"), surface: toRef(props, "surface"), courseId: toRef(props, "courseId"),
    visible: toRef(props, "visible"), parent: toRef(props, "parent"), activation: toRef(props, "activation"),
    connect(value) {
        adapter.value = value;
        return () => {
            if (adapter.value === value)
                adapter.value = null;
        };
    },
    authorize: props.authorize, openParent: props.openParent, openSettings: props.openSettings, editMaterial: props.editMaterial, notify: props.notify,
});
watch(() => props.modeId, () => { failure.value = ""; adapter.value = null; });
onErrorCaptured(error => { failure.value = error instanceof Error ? error.message : String(error); return false; });
function reload() { failure.value = ""; retry.value++; }
defineExpose({
    adapter,
    async prepareLeave() {
        if (!failure.value && props.visible && adapter.value?.ready)
            await adapter.value.prepareLeave();
    },
    async handleBack() { return await adapter.value?.handleBack() ?? false; },
    async exit() { await adapter.value?.exit(); },
    async refresh() {
        if (adapter.value?.ready)
            await adapter.value.refresh();
    },
});
</script>

<template>
  <section v-show="visible" class="mode-workspace" :data-mode-id="modeId" :aria-busy="adapter?.busy">
    <main v-if="failure || !Experience" class="frame-page mode-host-message">
      <h1>学习模式暂时无法加载</h1>
      <p role="alert">{{ failure || '当前学习模式尚未接入，请家长在设置中选择可用模式。' }}</p>
      <p>课程和学习记录保留，其他应用入口可以继续使用。</p>
      <button v-if="Experience" class="frame-button" @click="reload">重新加载模式</button>
      <button class="frame-button secondary" @click="openSettings">请家长处理</button>
    </main>
    <component v-else :is="Experience" :key="modeId + ':' + retry" />
  </section>
</template>
