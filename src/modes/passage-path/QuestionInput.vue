<script setup lang="ts">
import { computed } from "vue";
import type { PassageQuestion, PassageResponse } from "../../../packages/learning-modes/passage-path/model";
const props = defineProps<{ question: PassageQuestion; displayIds: string[]; disabled?: boolean }>();
const response = defineModel<PassageResponse>({ required: true });
const emit = defineEmits<{ change: []; submit: [] }>();
const options = computed(() => "options" in props.question ? props.displayIds.map(id => "options" in props.question ? props.question.options.find(option => option.id === id)! : null).filter(Boolean) : []);
const tokens = computed(() => props.question.kind === "order" ? props.displayIds.map(id => props.question.kind === "order" ? props.question.tokens.find(token => token.id === id)! : null).filter(Boolean) : []);
const selected = computed(() => response.value.selectedIds.map(id => tokens.value.find(token => token!.id === id)!).filter(Boolean));
function choose(id: string) { response.value = { ...response.value, text: "", selectedIds: [id] }; emit("change"); }
function toggle(id: string) {
  response.value = { text: "", selectedIds: response.value.selectedIds.includes(id) ? response.value.selectedIds.filter(value => value !== id) : [...response.value.selectedIds, id] };
  emit("change");
}
function enter(event: KeyboardEvent) { if (!event.isComposing && event.keyCode !== 229) { event.preventDefault(); emit("submit"); } }
</script>
<template>
  <fieldset class="passage-question-input" :disabled="disabled"><legend class="sr-only">你的答案</legend>
    <label v-if="question.kind === 'cloze'">填写答案<input v-model="response.text" maxlength="2000" autocapitalize="none" autocomplete="off" :spellcheck="false" enterkeyhint="done" @input="emit('change')" @keydown.enter="enter" /></label>
    <template v-else-if="question.kind === 'order'">
      <div class="passage-selected" aria-label="已选词块"><span v-if="!selected.length">按顺序点选词块</span><button v-for="(token, index) in selected" :key="token.id" type="button" :aria-label="`撤回词块 ${index + 1}：${token.text}`" @click="toggle(token.id)">{{ token.text }}</button></div>
      <div class="passage-tokens"><button v-for="token in tokens" :key="token!.id" type="button" :aria-pressed="response.selectedIds.includes(token!.id)" @click="toggle(token!.id)">{{ token!.text }}</button></div>
      <p class="field-help">点已选词块可以撤回。</p>
    </template>
    <div v-else class="passage-choices"><button v-for="option in options" :key="option!.id" type="button" :aria-pressed="response.selectedIds.includes(option!.id)" @click="choose(option!.id)">{{ option!.text }}</button></div>
  </fieldset>
</template>
