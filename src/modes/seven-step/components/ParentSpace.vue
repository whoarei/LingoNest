<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
  type UnwrapNestedRefs,
} from "vue";
import type { Ability } from "../../../../packages/learning-modes/seven-step/model";
import type { HistoryItem, LearningUI } from "../domain";
import {
  abilityLabels,
  answerText,
  attemptLabel,
  buildParentReport,
  type ParentTab,
} from "../../../../packages/learning-modes/seven-step/reporting";
import Icon from "../../../components/AppIcon.vue";
import CourseManager from "./CourseManager.vue";

const props = defineProps<{
  app: UnwrapNestedRefs<LearningUI>;
  active: boolean;
}>();
const tab = defineModel<ParentTab>("tab", { required: true });
const courseId = defineModel<string | null>("courseId", { required: true });
const courseManager = ref<{ handleBack(): Promise<boolean>; prepareLeave(): Promise<boolean> } | null>(null);
const emit = defineEmits<{ settings: []; image: [path: string] }>();
const titles: Record<ParentTab, string> = {
  overview: "家长空间",
  confirm: "口语确认",
  report: "学习报告",
  course: "课程管理",
  profiles: "孩子档案",
};
const descriptions: Record<ParentTab, string> = {
  overview: "看看孩子的学习情况，找到今天需要陪伴的一小步。",
  confirm: "先听孩子的表达，再确认这一次作答。",
  report: "看见具体能力与作答依据，分清练过和学会。",
  course: "对照教材核对内容，准备好本课的学习资源。",
  profiles: "每个孩子都有独立的学习记录，昵称就够了。",
};
const report = computed(() =>
  buildParentReport(props.app.history, props.app.skills, props.app.exercises),
);
const ability = ref<Ability | "all">("all");
const targetFilter = ref<"practiced" | "all">("practiced");
const reviewFilter = ref<"pending" | "reviewed">("pending");
const reviewed = computed(() =>
  props.app.history.filter(
    (item) => item.exercise.kind === "oral" && item.grade.source === "human",
  ),
);
const reviewItems = computed(() =>
  reviewFilter.value === "pending" ? props.app.pending : reviewed.value,
);
const reportTargets = computed(() =>
  report.value.targets.filter(
    (item) =>
      (ability.value === "all" ||
        item.exercise.target.ability === ability.value) &&
      (targetFilter.value === "all" || item.attempts.length > 0),
  ),
);
const nickname = ref("");
const creating = ref(false);
const renaming = ref(false);
const newName = ref("");
const checkedTranscript = ref(false);
const deleting = ref(false);
const deleteName = ref("");
const adultAnswer = ref("");
const adultUnlocked = ref(false);
const actionLabel = ref("");
const pendingAction = ref<(() => Promise<void>) | null>(null);
const heard = ref<string[]>([]);
const hearingId = ref<string | null>(null);
let playbackGeneration = 0;
const heardKey = (item: HistoryItem) => `${item.id}:${item.reviewRevision}`;

function closeAction() {
  pendingAction.value = null;
  adultAnswer.value = "";
}
async function handleBack(): Promise<boolean> {
  if (pendingAction.value) {
    closeAction();
    return true;
  }
  if (deleting.value) {
    deleting.value = false;
    return true;
  }
  if (renaming.value) {
    renaming.value = false;
    return true;
  }
  if (creating.value) {
    creating.value = false;
    return true;
  }
  if (tab.value === "course" && courseManager.value)
    return courseManager.value.handleBack();
  return false;
}
async function prepareLeave(): Promise<boolean> {
  if (tab.value === "course" && courseManager.value) return courseManager.value.prepareLeave();
  return true;
}
defineExpose({ handleBack, prepareLeave });
function stopPlayback() {
  playbackGeneration++;
  hearingId.value = null;
  void props.app.stopPlayback();
}
watch(
  () => `${props.app.learner?.id}:${props.app.course.id}`,
  () => {
    adultUnlocked.value = false;
    heard.value = [];
    closeAction();
    deleting.value = false;
    renaming.value = false;
    checkedTranscript.value = false;
    stopPlayback();
  },
);
watch(tab, () => {
  closeAction();
  deleting.value = false;
  stopPlayback();
  window.scrollTo({ top: 0, behavior: "instant" });
});
watch(
  () => props.active,
  (active) => {
    if (!active) {
      closeAction();
      deleting.value = false;
      stopPlayback();
    }
  },
);
onBeforeUnmount(stopPlayback);

async function requestAdult(label: string, action: () => Promise<void>) {
  if (props.app.busy || hearingId.value) return;
  if (adultUnlocked.value) await action();
  else {
    actionLabel.value = label;
    adultAnswer.value = "";
    pendingAction.value = action;
  }
}
async function confirmAdult() {
  if (
    adultAnswer.value.trim() !== "12" ||
    !pendingAction.value ||
    props.app.busy
  )
    return;
  const action = pendingAction.value;
  closeAction();
  adultUnlocked.value = true;
  await action();
}
async function hear(item: HistoryItem) {
  if (!item.recordingPath || props.app.busy || hearingId.value) return;
  const generation = ++playbackGeneration;
  hearingId.value = item.id;
  const played = await props.app.playRecording(item.recordingPath);
  if (generation !== playbackGeneration) return;
  hearingId.value = null;
  if (played && props.active && !heard.value.includes(heardKey(item)))
    heard.value.push(heardKey(item));
}
async function review(item: HistoryItem, passed: boolean) {
  if (!heard.value.includes(heardKey(item))) return;
  const revision = item.reviewRevision;
  const learnerId = props.app.learner?.id;
  await requestAdult("确认口语评价", async () => {
    if (props.app.learner?.id !== learnerId) return;
    await props.app.reviewAttempt(item.id, passed, revision);
  });
}
async function createProfile() {
  const name = nickname.value.trim();
  if (!name) return;
  await requestAdult("创建孩子档案", async () => {
    await props.app.addLearner(name);
    if (!props.app.error) {
      nickname.value = "";
      creating.value = false;
    }
  });
}
async function renameProfile() {
  const name = newName.value.trim();
  if (!name) return;
  await requestAdult("修改孩子昵称", async () => {
    await props.app.renameLearner(name);
    if (!props.app.error) renaming.value = false;
  });
}
async function removeProfile() {
  if (deleteName.value !== props.app.learner?.nickname || props.app.busy)
    return;
  await props.app.deleteLearner();
  if (!props.app.error) deleting.value = false;
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function reviewEvents(id: string) {
  return props.app.reviewLog.filter((event) => event.attemptId === id);
}
function showAbility(value: Ability) {
  ability.value = value;
  tab.value = "report";
}
</script>

<template>
  <main class="page parent-page">
    <section class="page-intro">
      <div>
        <span class="eyebrow">GROW TOGETHER</span>
        <h1>
          {{
            tab === "course" && courseId
              ? app.courses.find((item) => item.id === courseId)?.title ||
                "新建课程"
              : titles[tab]
          }}
        </h1>
        <p>{{ descriptions[tab] }}</p>
      </div>
      <button
        v-if="app.learner"
        class="parent-child-button"
        @click="tab = 'profiles'"
      >
        <span class="avatar">{{ app.learner.nickname.slice(0, 1) }}</span>
        <span
          ><small>当前孩子</small
          ><strong>{{ app.learner.nickname }}</strong></span
        >
        <Icon name="chevron" :size="17" />
      </button>
    </section>

    <section
      v-if="!app.learner && tab !== 'profiles' && tab !== 'course'"
      class="section-panel empty-state"
    >
      <Icon name="leaf" :size="42" />
      <h2>先为孩子建立一个小窝</h2>
      <p>使用昵称创建档案，学习记录会保存在这台设备上。</p>
      <button class="button primary" @click="tab = 'profiles'">
        创建孩子档案 <Icon name="arrow" />
      </button>
    </section>

    <template v-else-if="tab === 'overview'">
      <section class="parent-summary">
        <div>
          <span class="light-eyebrow">{{ app.course.subtitle }}</span>
          <h2>{{ app.learner?.nickname }}的学习小窝</h2>
          <p>
            {{ app.course.title }} ·
            {{ app.confirmed ? "本课原文已核对" : "等待家长核对原文" }}
          </p>
        </div>
        <button class="button cream compact" @click="tab = 'report'">
          查看学习报告 <Icon name="arrow" :size="17" />
        </button>
      </section>
      <section class="parent-metrics" aria-label="孩子学习概况">
        <div>
          <small>今天的练习</small
          ><strong>{{ app.stats.todayAttempts }}<span> 次</span></strong>
          <p>每一次尝试都留下记录</p>
        </div>
        <div>
          <small>完成的阶段</small
          ><strong
            >{{ app.stats.completedStages
            }}<span> / {{ app.stages.length }}</span></strong
          >
          <p>完成任务与掌握分别记录</p>
        </div>
        <div>
          <small>达到掌握门槛</small
          ><strong>{{ app.stats.mastered }}<span> 个目标</span></strong>
          <p>已测 {{ app.stats.measured }} 个目标</p>
        </div>
        <div>
          <small>待复习目标</small
          ><strong>{{ app.stats.dueCount }}<span> 个</span></strong>
          <p>按复习时间与复测资格安排</p>
        </div>
      </section>
      <section class="section-panel">
        <div class="section-heading">
          <h2>今天可以陪伴的事</h2>
          <span class="tag neutral">一步一步来</span>
        </div>
        <div class="parent-todos">
          <button
            v-if="!app.confirmed"
            class="parent-todo"
            @click="tab = 'course'"
          >
            <span class="circle-icon"><Icon name="book" /></span
            ><span
              ><strong>核对本课原文</strong
              ><small>对照教材，确认后孩子就能开始练习。</small></span
            ><Icon name="chevron" />
          </button>
          <button
            class="parent-todo"
            @click="
              reviewFilter = 'pending';
              tab = 'confirm';
            "
          >
            <span class="circle-icon"><Icon name="mic" /></span
            ><span
              ><strong>{{
                app.pending.length
                  ? `${app.pending.length} 条口语等待确认`
                  : "口语确认已处理完"
              }}</strong
              ><small>{{
                app.pending.length
                  ? "听听孩子的朗读与背诵，确认这次表达。"
                  : "新的录音提交后会出现在这里。"
              }}</small></span
            ><Icon name="chevron" />
          </button>
          <button class="parent-todo" @click="tab = 'report'">
            <span class="circle-icon"><Icon name="chart" /></span
            ><span
              ><strong>{{
                report.attention.length
                  ? `${report.attention.length} 个目标还需要练习`
                  : "看看各项能力的学习记录"
              }}</strong
              ><small>从具体词句与作答依据了解孩子的困难。</small></span
            ><Icon name="chevron" />
          </button>
          <button
            v-if="
              app.speech.supported &&
              app.speech.courseReady &&
              !app.speech.courseAudio.complete
            "
            class="parent-todo"
            @click="tab = 'course'"
          >
            <span class="circle-icon"><Icon name="volume" /></span
            ><span
              ><strong>准备本课音频</strong
              ><small
                >{{ app.speech.courseAudio.ready }} /
                {{ app.speech.courseAudio.total }}
                段已就绪，在课程管理继续准备。</small
              ></span
            ><Icon name="chevron" />
          </button>
        </div>
      </section>
      <section v-if="report.attention.length" class="section-panel">
        <div class="section-heading"><h2>需要关注的能力</h2></div>
        <button
          v-for="item in report.attention.slice(0, 3)"
          :key="item.key"
          class="parent-todo"
          @click="showAbility(item.exercise.target.ability)"
        >
          <span
            ><strong>{{ item.title }}</strong
            ><small
              >{{ abilityLabels[item.exercise.target.ability] }} ·
              最近一次有效测评还需练习</small
            ></span
          ><Icon name="chevron" />
        </button>
      </section>
      <section class="section-panel">
        <div class="section-heading">
          <h2>最近的练习</h2>
          <button class="text-button" @click="tab = 'report'">
            查看依据 <Icon name="arrow" :size="16" />
          </button>
        </div>
        <div v-if="!report.recent.length" class="empty-state compact-empty">
          <Icon name="leaf" :size="32" />
          <h3>还没有学习记录</h3>
          <p>孩子开始练习后，这里会展示最近的尝试。</p>
        </div>
        <div
          v-for="item in report.recent"
          :key="item.id"
          class="parent-history-row"
        >
          <div>
            <strong>{{ item.exercise.title }}</strong
            ><small
              >{{ abilityLabels[item.exercise.target.ability] }} ·
              {{ shortDate(item.submittedAt)
              }}{{ item.hintLevel ? " · 提示练习" : "" }}</small
            >
          </div>
          <span class="tag" :class="item.grade.passed ? 'green' : 'amber'">{{
            attemptLabel(item)
          }}</span>
        </div>
      </section>
    </template>

    <template v-else-if="tab === 'confirm'">
      <div class="parent-toolbar">
        <div class="segmented" aria-label="口语记录筛选">
          <button
            :class="{ active: reviewFilter === 'pending' }"
            @click="reviewFilter = 'pending'"
          >
            待确认 {{ app.pending.length }}</button
          ><button
            :class="{ active: reviewFilter === 'reviewed' }"
            @click="reviewFilter = 'reviewed'"
          >
            已确认 {{ reviewed.length }}
          </button>
        </div>
        <span v-if="adultUnlocked" class="tag green">家长操作已确认</span>
      </div>
      <p class="inline-note">
        确认通过表示这次表达通过；掌握状态仍需要独立作答和跨日复测。
      </p>
      <section
        v-if="!reviewItems.length"
        class="section-panel empty-state compact-empty"
      >
        <Icon name="mic" :size="38" />
        <h3>
          {{
            reviewFilter === "pending"
              ? "目前没有等待确认的录音"
              : "还没有已确认的口语记录"
          }}
        </h3>
        <p>孩子提交的朗读与背诵会保留在这里。</p>
      </section>
      <article
        v-for="item in reviewItems"
        :key="item.id"
        class="section-panel parent-review-card"
        :data-attempt-id="item.id"
      >
        <div class="oral-review-title">
          <h2>{{ item.exercise.title }}</h2>
          <span class="tag" :class="item.grade.passed ? 'green' : 'amber'">{{
            attemptLabel(item)
          }}</span>
        </div>
        <p class="field-help">
          {{ app.learner?.nickname }} · {{ app.course.subtitle }} · 提交于
          {{ shortDate(item.submittedAt)
          }}{{ item.hintLevel ? " · 使用过提示" : "" }}
        </p>
        <p class="review-reference" lang="en">{{ answerText(item, true) }}</p>
        <button
          v-if="item.recordingPath"
          class="button secondary compact"
          :disabled="app.busy || !!hearingId"
          @click="hear(item)"
        >
          <Icon
            :name="heard.includes(heardKey(item)) ? 'repeat' : 'play'"
            :size="17"
          />{{
            hearingId === item.id
              ? "正在回听…"
              : heard.includes(heardKey(item))
                ? "再听一次录音"
                : "先回听录音"
          }}
        </button>
        <p v-else class="inline-note">
          这条录音暂时无法回听，请让孩子重新录制后再确认。
        </p>
        <button
          v-if="hearingId === item.id"
          class="text-button"
          @click="stopPlayback"
        >
          停止回听
        </button>
        <p class="field-help">
          听完整段后，结合完整程度、词句是否正确和能否清楚听懂判断。设备没有自动评判发音。
        </p>
        <div class="review-actions">
          <button
            v-if="reviewFilter === 'pending' || item.grade.passed !== true"
            class="button primary compact"
            :disabled="
              app.busy || !!hearingId || !heard.includes(heardKey(item))
            "
            @click="review(item, true)"
          >
            {{ reviewFilter === "reviewed" ? "更正为通过" : "确认通过" }}
          </button>
          <button
            v-if="reviewFilter === 'pending' || item.grade.passed !== false"
            class="button secondary compact"
            :disabled="
              app.busy || !!hearingId || !heard.includes(heardKey(item))
            "
            @click="review(item, false)"
          >
            {{ reviewFilter === "reviewed" ? "更正为还需练习" : "还需要练习" }}
          </button>
        </div>
        <details v-if="reviewEvents(item.id).length" class="parent-evidence">
          <summary>查看 {{ reviewEvents(item.id).length }} 次确认记录</summary>
          <ol>
            <li v-for="event in reviewEvents(item.id)" :key="event.id">
              {{ shortDate(event.at) }} ·
              {{ event.passed ? "家长确认通过" : "家长确认还需练习" }}
            </li>
          </ol>
          <p class="field-help">
            更正会替换该次作答的有效评价，保留原确认记录。
          </p>
        </details>
      </article>
    </template>

    <template v-else-if="tab === 'report'">
      <section class="section-panel">
        <div class="section-heading"><h2>完成与掌握</h2></div>
        <div class="parent-report-summary">
          <div>
            <strong
              >{{ app.stats.completedStages }} / {{ app.stages.length }}</strong
            >
            <p>阶段任务完成</p>
          </div>
          <div>
            <strong
              >{{ app.stats.mastered }} / {{ report.targets.length }}</strong
            >
            <p>目标达到掌握门槛</p>
          </div>
        </div>
        <p class="field-help">
          一次通过、提示练习和待确认录音分别记录。没有有效测评时，保留“还未测试”或“尚无独立测评”。
        </p>
      </section>
      <section class="section-panel">
        <div class="section-heading"><h2>各项能力</h2></div>
        <div class="parent-abilities">
          <button
            v-for="item in report.abilities"
            :key="item.ability"
            :class="{ selected: ability === item.ability }"
            @click="ability = item.ability"
          >
            <strong>{{ item.label }}</strong
            ><span>已掌握 {{ item.mastered }} / {{ item.total }}</span
            ><small
              >已测 {{ item.measured }} 个目标{{
                item.pending ? ` · ${item.pending} 条待确认` : ""
              }}</small
            >
          </button>
        </div>
      </section>
      <section class="section-panel">
        <div class="section-heading">
          <h2>具体目标与作答依据</h2>
          <label class="sr-only" for="parent-ability">筛选能力</label
          ><select id="parent-ability" v-model="ability">
            <option value="all">全部能力</option>
            <option
              v-for="(label, value) in abilityLabels"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select>
        </div>
        <div class="segmented parent-target-filter" aria-label="目标记录范围">
          <button
            :class="{ active: targetFilter === 'practiced' }"
            @click="targetFilter = 'practiced'"
          >
            有作答记录
          </button>
          <button
            :class="{ active: targetFilter === 'all' }"
            @click="targetFilter = 'all'"
          >
            全部学习目标
          </button>
        </div>
        <div v-if="!reportTargets.length" class="empty-state compact-empty">
          <Icon name="leaf" :size="32" />
          <h3>这项能力还没有作答记录</h3>
          <p>
            开始练习后可以查看具体表现，也可以选择“全部学习目标”了解本课内容。
          </p>
        </div>
        <details
          v-for="item in reportTargets"
          :key="item.key"
          class="parent-target"
          :data-target-key="item.key"
        >
          <summary>
            <span
              ><strong>{{ item.title }}</strong
              ><small
                >{{ abilityLabels[item.exercise.target.ability] }} ·
                {{ item.skill?.evidenceCount || 0 }} 次有效记录</small
              ></span
            ><span
              class="tag"
              :class="
                item.skill?.status === 'mastered'
                  ? 'green'
                  : item.pending || item.skill?.latestPassed === false
                    ? 'amber'
                    : 'neutral'
              "
              >{{ item.label }}</span
            >
          </summary>
          <p v-if="!item.attempts.length" class="field-help">
            这个目标还没有作答记录，开始练习后才能了解表现。
          </p>
          <p v-else-if="!item.skill?.evidenceCount" class="field-help">
            提示作答、同轮重试或待确认录音不会直接形成独立掌握证据。
          </p>
          <p v-if="item.skill?.dueAt" class="field-help">
            下次复习时间：{{ shortDate(item.skill.dueAt)
            }}<template v-if="item.skill.eligibleAt">
              · 独立复测最早于 {{ shortDate(item.skill.eligibleAt) }}</template
            >
          </p>
          <div
            v-for="attempt in item.attempts"
            :key="attempt.id"
            class="parent-attempt"
          >
            <div class="parent-history-row">
              <small
                >{{ shortDate(attempt.submittedAt) }} ·
                {{
                  attempt.hintLevel
                    ? "提示练习"
                    : attempt.firstTest
                      ? "本轮首次作答"
                      : "本轮重试"
                }}{{
                  attempt.clockStatus === "suspect" ? " · 时间记录待核实" : ""
                }}</small
              ><span>{{ attemptLabel(attempt) }}</span>
            </div>
            <p><strong>孩子的作答：</strong>{{ answerText(attempt) }}</p>
            <p><strong>参考答案：</strong>{{ answerText(attempt, true) }}</p>
            <p class="field-help">{{ attempt.grade.feedback }}</p>
          </div>
        </details>
      </section>
    </template>

    <CourseManager
      v-else-if="tab === 'course'"
      ref="courseManager"
      v-model:course-id="courseId"
      :app="app"
      :active="active"
      :authorize="requestAdult"
      @settings="emit('settings')"
    />
    <template v-else-if="tab === 'profiles'">
      <section class="section-panel">
        <div class="section-heading">
          <h2>孩子的学习档案</h2>
          <button
            class="text-button"
            :disabled="app.busy || app.learners.length >= 8"
            @click="creating = !creating"
          >
            <Icon name="plus" :size="17" />新建
          </button>
        </div>
        <div class="learner-grid">
          <button
            v-for="learner in app.learners"
            :key="learner.id"
            class="learner-option"
            :class="{ selected: learner.id === app.learner?.id }"
            :disabled="app.busy || !!hearingId"
            @click="app.selectLearner(learner.id)"
          >
            <span class="avatar">{{ learner.nickname.slice(0, 1) }}</span
            ><span
              ><strong>{{ learner.nickname }}</strong
              ><small>{{
                learner.id === app.learner?.id ? "正在查看" : "查看这个孩子"
              }}</small></span
            ><Icon
              v-if="learner.id === app.learner?.id"
              name="check"
              :size="19"
            />
          </button>
        </div>
        <p v-if="app.learners.length >= 8" class="field-help">
          此设备最多保留 8 个学习档案。
        </p>
        <form
          v-if="creating || !app.learners.length"
          class="inline-profile-form"
          @submit.prevent="createProfile"
        >
          <label for="parent-nickname">新档案昵称</label>
          <div>
            <input
              id="parent-nickname"
              v-model="nickname"
              maxlength="16"
              placeholder="不需要真实姓名"
              autocomplete="off"
            /><button
              class="button primary compact"
              :disabled="!nickname.trim() || app.busy"
            >
              创建
            </button>
          </div>
        </form>
      </section>
      <section v-if="app.learner" class="section-panel">
        <div class="section-heading">
          <h2>当前档案 · {{ app.learner.nickname }}</h2>
          <button
            class="text-button"
            :disabled="app.busy"
            @click="
              renaming = !renaming;
              newName = app.learner.nickname;
            "
          >
            修改昵称
          </button>
        </div>
        <p class="field-help">
          建立于
          {{ shortDate(app.learner.createdAt) }}，学习记录按孩子分别保存。
        </p>
        <form
          v-if="renaming"
          class="inline-profile-form"
          @submit.prevent="renameProfile"
        >
          <label for="parent-new-name">新的昵称</label>
          <div>
            <input
              id="parent-new-name"
              v-model="newName"
              maxlength="16"
              autocomplete="off"
            /><button
              class="button primary compact"
              :disabled="!newName.trim() || app.busy"
            >
              保存昵称
            </button>
          </div>
        </form>
        <div class="danger-zone">
          <div>
            <h3>删除当前档案</h3>
            <p>清除 {{ app.learner.nickname }} 在本机的学习记录和录音。</p>
          </div>
          <button
            class="text-button danger-text"
            :disabled="app.busy"
            @click="
              requestAdult('管理档案删除', async () => {
                deleting = true;
                deleteName = '';
              })
            "
          >
            <Icon name="trash" :size="18" />删除档案
          </button>
        </div>
      </section>
      <p class="quiet-note">
        <Icon name="shield" :size="16" />{{
          app.storageLabel
        }}。多个档案共用模型配置与课程音频。
      </p>
    </template>

    <div
      v-if="pendingAction"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adult-title"
    >
      <section class="modal-card">
        <span class="circle-icon"><Icon name="shield" :size="26" /></span>
        <h2 id="adult-title">请陪伴学习的大人确认</h2>
        <p>{{ actionLabel }}前，回答一道防误触题。</p>
        <form class="parent-gate" @submit.prevent="confirmAdult">
          <p>请回答：<strong>7 + 5 = ?</strong></p>
          <div>
            <label class="sr-only" for="parent-answer">7加5的答案</label
            ><input
              id="parent-answer"
              v-model="adultAnswer"
              inputmode="numeric"
              pattern="12"
              placeholder="答案"
              autocomplete="off"
              required
            /><button
              class="button primary compact"
              :disabled="adultAnswer.trim() !== '12' || app.busy"
            >
              确认并继续
            </button>
          </div>
          <small>用于防止误触，不是身份认证。</small>
        </form>
        <button class="text-button" @click="closeAction">取消操作</button>
      </section>
    </div>
    <div
      v-if="deleting"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-delete-title"
    >
      <section class="modal-card">
        <span class="circle-icon danger-text"
          ><Icon name="trash" :size="26"
        /></span>
        <h2 id="parent-delete-title">
          删除「{{ app.learner?.nickname }}」的小窝？
        </h2>
        <p>
          该档案在本机的学习记录和录音将被删除，无法在应用内恢复。其他档案、模型配置和课程音频保留。
        </p>
        <label for="delete-name"
          >输入昵称「{{ app.learner?.nickname }}」确认</label
        ><input id="delete-name" v-model="deleteName" autocomplete="off" />
        <div class="modal-actions">
          <button
            class="button secondary"
            :disabled="app.busy"
            @click="deleting = false"
          >
            保留档案</button
          ><button
            class="button danger"
            :disabled="deleteName !== app.learner?.nickname || app.busy"
            @click="removeProfile"
          >
            确认删除
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
