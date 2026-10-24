<script setup lang="ts">
import { ref, watch } from "vue";
import type { PassageQuestion, PassageSource } from "../../../packages/learning-modes/passage-path/model";
const props = defineProps<{ question: PassageQuestion; source: PassageSource; busy: boolean; error: string }>();
const emit = defineEmits<{ save: [question: PassageQuestion]; cancel: [] }>();
const prompt = ref(""), explanation = ref(""), audioText = ref(""), answers = ref(""), order = ref("");
const options = ref<{ id: string; text: string }[]>([]), correctOptionId = ref(""), sourceTurnIds = ref<string[]>([]);
watch(() => props.question, question => {
  prompt.value = question.prompt; explanation.value = question.explanation; audioText.value = question.audioText ?? "";
  sourceTurnIds.value = [...question.sourceTurnIds];
  if (question.kind === "cloze") answers.value = question.answers.join("\n");
  else if (question.kind === "order") order.value = question.correctTokenIds.map(id => question.tokens.find(token => token.id === id)!.text).join("\n");
  else { options.value = question.options.map(option => ({ ...option })); correctOptionId.value = question.correctOptionId; }
}, { immediate: true });
function read(): PassageQuestion {
  const question = props.question;
  const base = { ...question, prompt: prompt.value.trim(), explanation: explanation.value.trim(), audioText: audioText.value.trim() || null, sourceTurnIds: [...sourceTurnIds.value] };
  if (question.kind === "cloze") return { ...base, kind: "cloze", demand: "recall", answers: answers.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) };
  if (question.kind === "order") {
    const tokens = order.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map((text, index) => ({ id: `token-${index}`, text }));
    return { ...base, kind: "order", demand: "supported", tokens, correctTokenIds: tokens.map(token => token.id) };
  }
  return { ...base, kind: question.kind, demand: "recognize", options: options.value.map(option => ({ ...option, text: option.text.trim() })), correctOptionId: correctOptionId.value };
}
defineExpose({ read });
</script>

<template>
  <form class="passage-question-editor passage-card" aria-label="修改候选题" @submit.prevent="emit('save', read())">
    <h3>修改本题</h3>
    <p>保存为新修订，其他题目的审核进度保留。本题修改后需重新审核；已发布课程和历史作答保留。</p>
    <p v-if="error" class="passage-error">修改尚未保存：{{ error }}</p>
    <fieldset :disabled="busy">
      <label>题目<textarea v-model="prompt" required maxlength="1000" rows="3" /></label>
      <template v-if="question.kind === 'cloze'"><label>可接受答案（每行一个）<textarea v-model="answers" required rows="3" /></label></template>
      <template v-else-if="question.kind === 'order'"><label>正确词块顺序（每行一个词块）<textarea v-model="order" required rows="5" /></label><p>孩子作答时，词块会重新打乱排列。</p></template>
      <template v-else>
        <label v-for="(option, index) in options" :key="option.id">选项 {{ index + 1 }}<input v-model="option.text" required maxlength="500" /></label>
        <label>正确答案<select v-model="correctOptionId"><option v-for="(option, index) in options" :key="option.id" :value="option.id">{{ index + 1 }}. {{ option.text }}</option></select></label>
      </template>
      <label>答案说明<textarea v-model="explanation" required maxlength="1000" rows="3" /></label>
      <label>题目音频文字{{ question.kind === 'listen-choice' ? '（必填）' : '（可选）' }}<textarea v-model="audioText" :required="question.kind === 'listen-choice'" maxlength="1000" rows="2" /></label>
      <fieldset><legend>原文依据（至少选一段）</legend><label v-for="turn in source.turns" :key="turn.id" class="passage-check"><input v-model="sourceTurnIds" type="checkbox" :value="turn.id" />{{ turn.speaker }}：{{ turn.text }}</label></fieldset>
      <div class="passage-actions"><button type="submit" class="primary">保存本题修改</button><button type="button" @click="emit('cancel')">取消修改</button></div>
    </fieldset>
  </form>
</template>
