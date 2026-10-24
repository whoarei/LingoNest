<script setup lang="ts">
import { computed } from "vue";
import type { PassageLesson, PassagePackage, PassageState } from "../../../packages/learning-modes/passage-path/model";
import { completedLessons, hasCurriculum, lessonTitle, passageLessons } from "../../../packages/learning-modes/passage-path/curriculum";
const props = defineProps<{ state: PassageState; pkg: PassagePackage; learnerId: string; disabled: boolean }>();
defineEmits<{ replay: [levelId: string, lesson?: PassageLesson] }>();
const completed = computed(() => props.state.completions.filter(item => item.learnerId === props.learnerId && item.courseId === props.pkg.courseId && item.revision === props.pkg.revision).map(item => item.levelId));
const lessons = computed(() => new Map(props.pkg.levels.map(level => [level.id, completedLessons(props.state, props.learnerId, props.pkg, level.id)])));
</script>
<template>
  <ol class="passage-levels" aria-label="课程路径">
    <li v-for="(level, index) in pkg.levels" :key="level.id" class="passage-card">
      <span class="level-number">{{ completed.includes(level.id) ? '✓' : index + 1 }}</span>
      <div><h2>{{ level.title }}</h2><p>{{ completed.includes(level.id) ? '路径已完成' : index === completed.length ? '下一小步' : '前面关卡完成后开放' }}</p>
        <template v-if="hasCurriculum(pkg)"><p>{{ lessons.get(level.id)!.length }} / 3 小课已完成</p>
          <ol class="passage-lesson-list"><li v-for="lesson in passageLessons" :key="lesson">
            <span>{{ lessons.get(level.id)!.includes(lesson) ? '✓ ' : '' }}{{ lessonTitle(lesson) }}</span>
            <button v-if="lessons.get(level.id)!.includes(lesson)" :disabled="disabled" :aria-label="`重练${level.title}的${lessonTitle(lesson)}`" @click="$emit('replay', level.id, lesson)">重练{{ lessonTitle(lesson) }}</button>
          </li></ol>
        </template>
      </div>
      <button v-if="!hasCurriculum(pkg) && completed.includes(level.id)" :disabled="disabled" @click="$emit('replay', level.id)">重练</button>
    </li>
  </ol>
</template>
