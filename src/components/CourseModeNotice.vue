<script setup lang="ts">
import type { CourseModeStatus } from "../../packages/learning-modes/availability";
defineProps<{ title: string; modeTitle: string; status: CourseModeStatus; parent?: boolean }>();
defineEmits<{ prepare: [] }>();
</script>
<template>
  <section class="course-mode-notice" role="status">
    <h2>{{ status === 'review' ? '当前模式内容待审核' : status === 'draft' ? '当前模式内容尚未准备完成' : '本课尚未生成当前模式内容' }}</h2>
    <p>{{ title }} · {{ modeTitle }}</p>
    <p>请家长在课程管理中生成并审核当前模式的内容，审核通过后再开放学习。原有课程和学习进度保留。</p>
    <button type="button" @click="$emit('prepare')">{{ parent ? '生成并审核当前模式' : '请家长生成并审核' }}</button>
  </section>
</template>
<style scoped>
.course-mode-notice { padding: 24px; border: 1px solid #dccdad; border-radius: 16px; background: #fffaf0; }
.course-mode-notice h2 { margin: 0 0 12px; }
.course-mode-notice p { margin: 10px 0; line-height: 1.65; }
.course-mode-notice button { margin-top: 10px; padding: 12px 18px; border: 0; border-radius: 10px; color: white; background: #267267; font: inherit; cursor: pointer; }
</style>
