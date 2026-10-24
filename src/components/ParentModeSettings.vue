<script setup lang="ts">
import { ref } from "vue";
import CourseModeSettings from "./CourseModeSettings.vue";
import type { ModeSelection } from "../platform/mode-selection";
defineProps<{ selection: ModeSelection }>();
const answer = ref("");
const action = ref<(() => Promise<void>) | null>(null);
const authorize = async (_label: string, run: () => Promise<void>) => { answer.value = ""; action.value = run; };
async function confirm() {
  if (answer.value.trim() !== "12" || !action.value) return;
  const run = action.value; action.value = null;
  await run();
}
</script>
<template>
  <section aria-label="家长课程模式管理">
    <CourseModeSettings :selection="selection" :authorize="authorize" />
    <form v-if="action" @submit.prevent="confirm" class="mode-confirm">
      <p>请陪伴学习的大人确认：7 + 5 = ?</p>
      <label>7加5的答案 <input v-model="answer" inputmode="numeric" autocomplete="off" /></label>
      <button :disabled="answer.trim() !== '12'">确认并继续</button>
      <button type="button" @click="action = null">取消操作</button>
      <p>用于防止误触，不是身份认证。</p>
    </form>
  </section>
</template>
<style scoped>
.mode-confirm { margin: 20px 0; padding: 20px; border: 1px solid #bccbbf; border-radius: 12px; }
.mode-confirm input { width: 60px; margin: 8px; font: inherit; }
.mode-confirm button { padding: 10px; margin: 6px; cursor: pointer; }
</style>
