<script setup lang="ts">
import { defineAsyncComponent, ref, onErrorCaptured } from "vue";
import { teachingModes } from "./registry";

// Only seven-step is installed in this extraction. Global switching and its
// multi-mode storage migration are introduced with the next real mode.
const registration = teachingModes.requireMode(teachingModes.defaultModeId);
const failure = ref("");
const Experience = defineAsyncComponent(registration.loadExperience);
onErrorCaptured((error) => {
  failure.value = error instanceof Error ? error.message : String(error);
  return false;
});
</script>

<template>
  <main v-if="failure" class="page" role="alert">
    <h1>学习模式暂时无法加载</h1>
    <p>{{ failure }}</p>
    <p>已有课程与学习记录保留，请重新打开应用后重试。</p>
  </main>
  <component :is="Experience" v-else />
</template>

<style scoped>
main {
  max-width: 42rem;
  margin: 3rem auto;
  padding: 1.5rem;
  font: 16px/1.6 system-ui, sans-serif;
}
</style>
