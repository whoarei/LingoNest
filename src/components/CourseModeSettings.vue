<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { ModeSelection } from "../platform/mode-selection";
const props = defineProps<{ selection: ModeSelection; authorize: (label: string, action: () => Promise<void>) => Promise<void> }>();
const selection = props.selection;
const error = ref("");
async function choose(id: string) {
  if (selection.busy.value || id === selection.activeModeId.value) return;
  await props.authorize("切换全部课程的学习模式", async () => {
    try { error.value = ""; await selection.select(id); }
    catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure); }
  });
}
async function move(event: KeyboardEvent, index: number) {
  const count = selection.modes.length;
  if (!count || !["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1
    : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + count) % count;
  const button = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next];
  if (!button || button.disabled) return;
  button.focus();
  await choose(selection.modes[next]!.id);
  await nextTick();
  if (button.isConnected && !button.disabled) button.focus();
}
</script>
<template>
  <section class="course-mode-settings" aria-labelledby="global-course-mode-title">
    <h2 id="global-course-mode-title">课程模式</h2>
    <p>每次只向孩子开放一个模式，统一作用于这台设备上的所有课程和孩子档案。</p>
    <div role="radiogroup" aria-label="全局课程模式" class="mode-choices">
      <button v-for="(mode, index) in selection.modes" :key="mode.id" type="button" role="radio"
        :aria-checked="selection.activeModeId.value === mode.id" :disabled="selection.busy.value"
        :tabindex="selection.activeModeId.value === mode.id || !selection.modes.some(item => item.id === selection.activeModeId.value) && index === 0 ? 0 : -1"
        @keydown="move($event, index)"
        @click="choose(mode.id)">
        <strong>{{ mode.title }}</strong>
        <span>{{ selection.activeModeId.value === mode.id ? '当前开放' : '切换到此模式' }}</span>
      </button>
    </div>
    <p v-if="selection.modes.length === 1" class="mode-note">目前只有{{ selection.modes[0]?.title }}模式可用，更多模式接入后会出现在这里。</p>
    <p v-if="selection.modes.length === 0" class="mode-note">尚未接入学习模式。教材、孩子档案和应用设置可以继续管理。</p>
    <p class="mode-note">切换保留各模式的课程内容和学习进度。课程缺少当前模式内容时，请家长先生成并审核，孩子才能开始学习。</p>
    <p v-if="error || selection.error.value" role="alert">{{ error || selection.error.value }}</p>
  </section>
</template>
<style scoped>
.course-mode-settings { padding: 22px; border: 1px solid #dce3db; border-radius: 18px; background: #fffef9; }
.course-mode-settings h2 { margin: 0 0 10px; }
.course-mode-settings p { margin: 10px 0; line-height: 1.65; }
.mode-choices { display: grid; gap: 12px; margin: 20px 0; }
.mode-choices button { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 60px; padding: 16px; border: 2px solid #dce3db; border-radius: 12px; text-align: left; background: white; color: #293e33; font: inherit; cursor: pointer; }
.mode-choices button[aria-checked="true"] { border-color: #254e3d; background: #edf4ef; }
.mode-choices span { font-size: 13px; color: #617064; }
.mode-choices button[aria-checked="true"] span { color: #254e3d; font-weight: 650; }
.mode-choices button:focus-visible { outline: 3px solid #a86534; outline-offset: 3px; }
.mode-choices button:disabled { opacity: .6; }
.mode-note { color: #69776e; font-size: 13px; }
</style>
