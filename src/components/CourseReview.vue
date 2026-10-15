<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { sourceTurns, type CourseRecipe, type Vocabulary } from "../course-library";
import Icon from "./AppIcon.vue";

const props = defineProps<{ sourceText: string; vocabulary: Vocabulary[] }>();
const recipe = defineModel<CourseRecipe>({ required: true });
const turns = computed(() => sourceTurns(props.sourceText));
const words = computed(() => props.vocabulary.filter((word) => word.selected));
const tab = ref<"translations" | "comprehension" | "applications">("translations");
const editing = ref<number | null>(null);
watch(() => recipe.value, () => {
  tab.value = "translations";
  editing.value = null;
});
const tabs = computed(() => [
  { id: "translations" as const, label: "课文释义", count: turns.value.length },
  { id: "comprehension" as const, label: "理解题", count: recipe.value.comprehension.length },
  { id: "applications" as const, label: "情境应用", count: recipe.value.applications.length },
]);
function select(id: typeof tab.value) {
  tab.value = id;
  editing.value = null;
}
</script>

<template>
  <div class="course-review">
    <header class="course-review-overview">
      <div class="course-review-intro">
        <span class="course-review-emblem"><Icon name="shield" :size="24" /></span>
        <div>
          <span class="course-review-eyebrow">课程审核</span>
          <h2>审核学习内容</h2>
        </div>
        <span class="course-review-status">待审核</span>
      </div>
      <p class="course-review-lead">核对释义、题目与答案，修改后再交给孩子学习。</p>
      <div class="course-review-metrics">
        <div><strong>{{ turns.length }}</strong><span>课文段落</span></div>
        <div><strong>{{ words.length }}</strong><span>重点词汇</span></div>
        <div><strong>{{ recipe.comprehension.length + recipe.applications.length }}</strong><span>练习题目</span></div>
      </div>
      <details v-if="words.length" class="course-review-vocabulary">
        <summary>查看重点词汇 <Icon name="chevron" :size="15" /></summary>
        <div class="course-review-word-chips">
          <span v-for="word in words" :key="word.term">
            <strong lang="en">{{ word.term }}</strong><span>{{ word.meaning }}</span>
          </span>
        </div>
      </details>
    </header>

    <nav class="course-review-tabs" aria-label="审核内容分类">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        :aria-label="item.label"
        :aria-pressed="tab === item.id"
        @click="select(item.id)"
      >
        <span>{{ item.label }}</span><small>{{ item.count }}</small>
      </button>
    </nav>

    <div v-if="tab === 'translations'" class="course-review-content">
      <p class="course-review-caption">对照原文，逐段核对中文释义。</p>
      <article v-for="(turn, index) in turns" :key="turn.id" class="course-review-card">
        <header class="course-review-card-heading">
          <span class="course-review-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span>课文对照 <small v-if="turn.speaker !== '课文'">· {{ turn.speaker }}</small></span>
          <button type="button" class="text-button" :aria-label="`编辑第 ${index + 1} 段释义`" @click="editing = editing === index ? null : index">
            {{ editing === index ? "收起" : "编辑释义" }}
          </button>
        </header>
        <p class="course-review-original" lang="en">{{ turn.text }}</p>
        <div class="course-review-translation">
          <span class="course-review-label">中文释义</span>
          <template v-if="editing === index">
            <label class="sr-only" :for="`translation-${index}`">第 {{ index + 1 }} 段释义</label>
            <textarea :id="`translation-${index}`" v-model="recipe.translations[index]" rows="4" maxlength="2000" />
          </template>
          <p v-else>{{ recipe.translations[index] }}</p>
        </div>
        <button v-if="editing === index" type="button" class="text-button course-review-done" @click="editing = null">完成编辑</button>
      </article>
    </div>

    <div v-else-if="tab === 'comprehension'" class="course-review-content">
      <p class="course-review-caption">绿色选项为正确答案，请结合原文检查。</p>
      <article v-for="(item, index) in recipe.comprehension" :key="index" class="course-review-card">
        <header class="course-review-card-heading">
          <span class="course-review-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span>理解题</span>
          <button type="button" class="text-button" :aria-label="`编辑理解题 ${index + 1}`" @click="editing = editing === index ? null : index">
            {{ editing === index ? "收起" : "编辑" }}
          </button>
        </header>
        <div v-if="editing === index" class="course-review-editor">
          <label :for="`question-${index}`">问题 {{ index + 1 }}</label>
          <textarea :id="`question-${index}`" v-model="item.question" rows="2" maxlength="1000" />
          <div v-for="(_, option) in item.options" :key="option">
            <label :for="`option-${index}-${option}`">选项 {{ option + 1 }}</label>
            <input :id="`option-${index}-${option}`" v-model="item.options[option]" maxlength="500" />
          </div>
          <label :for="`correct-${index}`">正确选项 {{ index + 1 }}</label>
          <select :id="`correct-${index}`" v-model.number="item.answerIndex">
            <option v-for="(option, i) in item.options" :key="i" :value="i">{{ String.fromCharCode(65 + i) }} · {{ option }}</option>
          </select>
          <label :for="`explanation-${index}`">解释 {{ index + 1 }}</label>
          <textarea :id="`explanation-${index}`" v-model="item.explanation" rows="3" maxlength="1000" />
          <button type="button" class="text-button course-review-done" @click="editing = null">完成编辑</button>
        </div>
        <template v-else>
          <h3 class="course-review-question">{{ item.question }}</h3>
          <ol class="course-review-options">
            <li v-for="(option, i) in item.options" :key="i" :class="{ correct: item.answerIndex === i }">
              <span class="course-review-option-letter">{{ String.fromCharCode(65 + i) }}</span>
              <span>{{ option }}</span>
              <small v-if="item.answerIndex === i"><Icon name="check" :size="14" /><span>正确答案</span></small>
            </li>
          </ol>
          <div class="course-review-reason"><span class="course-review-label">答案解析</span><p>{{ item.explanation }}</p></div>
        </template>
      </article>
    </div>

    <div v-else class="course-review-content">
      <p class="course-review-caption">核对任务是否明确，参考答案是否适合本课。</p>
      <article v-for="(item, index) in recipe.applications" :key="index" class="course-review-card">
        <header class="course-review-card-heading">
          <span class="course-review-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span>情境应用</span>
          <button type="button" class="text-button" :aria-label="`编辑情境应用 ${index + 1}`" @click="editing = editing === index ? null : index">
            {{ editing === index ? "收起" : "编辑" }}
          </button>
        </header>
        <div v-if="editing === index" class="course-review-editor">
          <label :for="`application-${index}`">应用任务 {{ index + 1 }}</label>
          <textarea :id="`application-${index}`" v-model="item.prompt" rows="3" maxlength="1000" />
          <label :for="`answers-${index}`">可接受答案 {{ index + 1 }}（每行一个）</label>
          <textarea :id="`answers-${index}`" :value="item.answers.join('\n')" @input="item.answers = ($event.target as HTMLTextAreaElement).value.split('\n').filter((answer) => answer.trim())" rows="3" />
          <label :for="`application-hint-${index}`">应用提示 {{ index + 1 }}</label>
          <textarea :id="`application-hint-${index}`" v-model="item.explanation" rows="3" maxlength="1000" />
          <button type="button" class="text-button course-review-done" @click="editing = null">完成编辑</button>
        </div>
        <template v-else>
          <h3 class="course-review-question">{{ item.prompt }}</h3>
          <div class="course-review-answers">
            <span class="course-review-label">参考答案</span>
            <p v-for="answer in item.answers" :key="answer" lang="en">{{ answer }}</p>
          </div>
          <div class="course-review-reason"><span class="course-review-label">应用提示</span><p>{{ item.explanation }}</p></div>
        </template>
      </article>
    </div>
  </div>
</template>
