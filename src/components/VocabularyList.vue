<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { Vocabulary } from "../course-library";
import Icon from "./AppIcon.vue";

const words = defineModel<Vocabulary[]>({ required: true });
const editingWord = ref<Vocabulary | null>(null);
const origins = { photo: "教材词表", auto: "应用建议", manual: "手动补充" };

async function add() {
  if (words.value.length >= 80) return;
  words.value.push({
    term: "",
    meaning: "",
    example: "",
    selected: true,
    origin: "manual",
  });
  editingWord.value = words.value[words.value.length - 1]!;
  await nextTick();
  document.getElementById(`word-term-${words.value.length - 1}`)?.focus();
}
function remove(index: number) {
  if (editingWord.value === words.value[index]) editingWord.value = null;
  words.value.splice(index, 1);
}
async function focusIncomplete() {
  const index = words.value.findIndex(
    (word) => word.selected && (!word.term.trim() || !word.meaning.trim()),
  );
  if (index < 0) return;
  const word = words.value[index]!;
  editingWord.value = word;
  await nextTick();
  document
    .getElementById(`word-${word.term.trim() ? "meaning" : "term"}-${index}`)
    ?.focus();
}
defineExpose({ focusIncomplete });
</script>

<template>
  <div v-if="words.length" class="vocabulary-list">
    <p class="vocabulary-count" role="status">
      <strong>重点词汇</strong>
      <span>已选 {{ words.filter((word) => word.selected).length }} / {{ words.length }}</span>
    </p>
    <article
      v-for="(word, index) in words"
      :key="index"
      class="course-word vocabulary-item"
      :class="{ editing: editingWord === word, unselected: !word.selected }"
    >
      <div class="vocabulary-row">
        <label class="vocabulary-select">
          <input v-model="word.selected" type="checkbox" />
          <span class="sr-only">纳入重点词汇 {{ index + 1 }}</span>
        </label>
        <button
          type="button"
          class="vocabulary-toggle"
          :aria-label="`编辑词条 ${index + 1}：${word.term || '未填写'}`"
          :aria-expanded="editingWord === word"
          :aria-controls="`word-editor-${index}`"
          @click="editingWord = editingWord === word ? null : word"
        >
          <span class="vocabulary-copy">
            <strong lang="en">{{ word.term || "待填写词条" }}</strong>
            <span :class="{ 'vocabulary-missing': !word.meaning.trim() }">
              {{ word.meaning || "待补释义" }}
            </span>
          </span>
          <span class="vocabulary-toggle-label">{{ editingWord === word ? "收起" : "编辑" }}</span>
          <Icon name="chevron" :size="16" />
        </button>
      </div>
      <div
        v-if="editingWord === word"
        :id="`word-editor-${index}`"
        class="vocabulary-editor"
      >
        <small class="vocabulary-origin">来源：{{ origins[word.origin] }}</small>
        <div class="content-config-grid">
          <div>
            <label :for="`word-term-${index}`">词条 {{ index + 1 }}</label>
            <input :id="`word-term-${index}`" v-model="word.term" maxlength="100" />
          </div>
          <div>
            <label :for="`word-meaning-${index}`">释义 {{ index + 1 }}</label>
            <input :id="`word-meaning-${index}`" v-model="word.meaning" maxlength="300" />
          </div>
        </div>
        <label :for="`word-example-${index}`">例句 {{ index + 1 }}（可选）</label>
        <input :id="`word-example-${index}`" v-model="word.example" maxlength="1000" />
        <div class="vocabulary-editor-actions">
          <button type="button" class="text-button danger-text" @click="remove(index)">
            删除词条 {{ index + 1 }}
          </button>
          <button type="button" class="text-button" @click="editingWord = null">完成</button>
        </div>
      </div>
    </article>
  </div>
  <button type="button" class="text-button" :disabled="words.length >= 80" @click="add">
    <Icon name="plus" :size="16" />补充词汇
  </button>
</template>
