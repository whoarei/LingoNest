<script setup lang="ts">
import { ref } from "vue";
import type { PassagePackage } from "../../../packages/learning-modes/passage-path/model";
import type { PassageOutline } from "../../../packages/learning-modes/passage-path/review";
const props = defineProps<{ package: PassagePackage; busy: boolean; error: string }>();
const emit = defineEmits<{ save: [outline: PassageOutline]; cancel: [] }>();
const draft = ref<PassageOutline>(JSON.parse(JSON.stringify({ chunks: props.package.chunks, goals: props.package.goals, levels: props.package.levels })));
function read(): PassageOutline { return JSON.parse(JSON.stringify(draft.value)); }
defineExpose({ read });
</script>
<template>
  <form class="passage-card passage-question-editor" aria-label="修改知识块与关卡" @submit.prevent="emit('save', read())">
    <h3>修改知识块与关卡</h3><p>修改后建立新候选修订，需要重新确认教材安排；相关题目的审核会重置，其他题目保留。</p>
    <p v-if="error" class="passage-error">修改尚未保存：{{ error }}</p>
    <fieldset :disabled="busy">
      <fieldset v-for="(chunk, index) in draft.chunks" :key="chunk.id"><legend>知识块 {{ index + 1 }}</legend>
        <label>知识块 {{ index + 1 }} 名称<input v-model="chunk.title" required maxlength="200" /></label>
        <label>知识块 {{ index + 1 }} 原文表达<textarea v-model="chunk.expression" required rows="2" /></label>
        <label>知识块 {{ index + 1 }} 释义<textarea v-model="chunk.meaning" required rows="2" /></label>
      </fieldset>
      <label v-for="(goal, index) in draft.goals" :key="goal.id">学习目标 {{ index + 1 }} 名称<input v-model="goal.title" required maxlength="200" /></label>
      <label v-for="(level, index) in draft.levels" :key="level.id">关卡 {{ index + 1 }} 名称<input v-model="level.title" required maxlength="200" /></label>
      <div class="passage-actions"><button type="submit" class="primary">保存知识块与关卡修改</button><button type="button" @click="emit('cancel')">取消修改</button></div>
    </fieldset>
  </form>
</template>
