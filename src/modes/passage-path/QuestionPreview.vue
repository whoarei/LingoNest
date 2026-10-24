<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import type { PassageQuestion, PassageResponse } from "../../../packages/learning-modes/passage-path/model";
import { gradeQuestion } from "../../../packages/learning-modes/passage-path/grading";
import { answerText } from "../../../packages/learning-modes/passage-path/presentation";
import QuestionInput from "./QuestionInput.vue";
const props = defineProps<{ question: PassageQuestion; audioReady: boolean; busy: boolean }>();
const emit = defineEmits<{ close: []; play: [text: string] }>();
const response = ref<PassageResponse>({ text: "", selectedIds: [] }), checked = ref(false);
const ids = computed(() => props.question.kind === "cloze" ? [] : (props.question.kind === "order" ? [...props.question.correctTokenIds].reverse() : props.question.options.map(option => option.id)));
const canCheck = computed(() => props.question.kind === "cloze" ? !!response.value.text.trim() : props.question.kind === "order" ? response.value.selectedIds.length === ids.value.length : response.value.selectedIds.length > 0);
const correct = computed(() => checked.value && gradeQuestion(props.question, response.value));
const panel = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); emit("close"); }
  if (event.key !== "Tab") return;
  const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(control => !control.matches(":disabled") && control.offsetWidth);
  const first = controls[0], last = controls[controls.length - 1];
  if (!panel.value?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onMounted(() => { previousFocus = document.activeElement as HTMLElement; panel.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); document.addEventListener('keydown', keyboard); });
onBeforeUnmount(() => { document.removeEventListener('keydown', keyboard); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
function check() { if (canCheck.value) checked.value = true; }
function reset() { checked.value = false; response.value = { text: "", selectedIds: [] }; }
</script>
<template>
  <div class="passage-preview-backdrop" @click.self="emit('close')"><section ref="panel" class="passage-card passage-preview" role="dialog" aria-modal="true" aria-labelledby="passage-preview-title">
    <div class="passage-actions"><h2 id="passage-preview-title">孩子视角预览</h2><button type="button" @click="emit('close')">返回审核</button></div>
    <p class="field-help">这里可以先试答，不计入孩子的学习记录，也不会自动通过审核。</p>
    <h3>{{ question.prompt }}</h3>
    <template v-if="question.audioText"><button :disabled="!audioReady || busy" @click="emit('play', question.audioText!)">播放题目音频</button><p v-if="!audioReady" class="field-help">题目音频尚未就绪，准备音频后可试听。</p></template>
    <QuestionInput v-model="response" :question="question" :display-ids="ids" :disabled="checked || busy" @submit="check" />
    <button v-if="!checked" class="primary" :disabled="!canCheck || busy" @click="check">检查预览答案</button>
    <div v-else class="passage-feedback" role="status"><h3>{{ correct ? '答对了' : '一起看一看' }}</h3><p>参考答案：{{ answerText(question) }}</p><p>{{ question.explanation }}</p><button @click="reset">重新试答</button></div>
  </section></div>
</template>
