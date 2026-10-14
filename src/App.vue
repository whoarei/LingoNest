<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from "vue";
import { isAndroid, native } from "./native";
import { useLearning } from "./useLearning";
import type { SkillState } from "../packages/learning-engine/src/model";
import type { LearningUI } from "./domain";
import Icon from "./components/AppIcon.vue";
import SpeechSettings from "./components/SpeechSettings.vue";
import ParentSpace from "./components/ParentSpace.vue";
import ContentSettings from "./components/ContentSettings.vue";
import SourceImages from "./components/SourceImages.vue";
import {
  abilityLabels,
  statusLabels,
  parentNav,
  type ParentTab,
} from "./parent-report";
import "./style.css";

const app = reactive(useLearning());
const nickname = ref("");
const block = ref<"A" | "B" | "C">("A");
const checkedTranscript = ref(false);
const imagePreview = ref<string | null>(null);
const referenceRevealed = ref(false);
const parentMode = ref(false);
const parentTab = ref<ParentTab>("overview");
const managedCourseId = ref<string | null>(null);
const parentSpace = ref<{ handleBack(): Promise<boolean> } | null>(null);
const settingsOrigin = ref<LearningUI["view"]["value"]>("home");
watch(parentTab, () => {
  managedCourseId.value = null;
});
let handlingBack = false;
let disposed = false;
let backSubscription: { remove(): Promise<void> } | undefined;
onMounted(() => {
  if (isAndroid)
    void native
      .addListener("backButton", () => {
        void handleBack().catch(() => {
          app.error = "返回未完成，请重试。";
        });
      })
      .then((handle) => {
        if (disposed) void handle.remove();
        else backSubscription = handle;
      });
});
onBeforeUnmount(() => {
  disposed = true;
  void backSubscription?.remove();
});
const learningScroll = ref(0);
const exitPractice = ref(false);
const exitDestination = ref<"home" | "parent">("home");
const learningView = ref<LearningUI["view"]["value"]>("home");
const nav = [
  { id: "home", label: "小窝", icon: "home" },
  { id: "lesson", label: "课文", icon: "book" },
  { id: "review", label: "复习", icon: "repeat" },
  { id: "progress", label: "成长", icon: "chart" },
] as const;
const blockNames = {
  A: "篮球队的邀请",
  B: "聊聊喜欢的运动",
  C: "一起加入球队",
};
const turns = computed(() =>
  app.course.turns.filter((turn) => turn.block === block.value),
);
const nextStage = computed(
  () =>
    app.stages.find((stage) => stage.available && !stage.verified) ||
    app.stages.find((stage) => stage.available),
);
const completedPercent = computed(() =>
  Math.round(
    (app.stats.completedStages / Math.max(app.stages.length, 1)) * 100,
  ),
);
const exercise = computed(() => app.currentExercise);
const isLast = computed(() => app.practice.position + 1 >= app.practice.total);
const canSubmit = computed(() => {
  if (!exercise.value || app.busy || app.recording || app.feedback)
    return false;
  if (exercise.value.kind === "oral") return !!app.recordingPath;
  if (["choice", "order"].includes(exercise.value.kind))
    return app.selectedIds.length > 0;
  return app.answer.trim().length > 0;
});
const orderedTokens = computed(() =>
  app.selectedIds.flatMap((id) => {
    const token = exercise.value?.tokens?.find((item) => item.id === id);
    return token ? [token] : [];
  }),
);
const oralReferenceVisible = computed(
  () => exercise.value?.stageId === "S4" || referenceRevealed.value,
);
const newestHistory = computed(() =>
  [...app.history]
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 6),
);
const dueSkills = computed(() =>
  app.skills.filter(
    (skill) =>
      skill.status === "review_due" ||
      (skill.dueAt && new Date(skill.dueAt).getTime() <= Date.now()),
  ),
);
const feedbackAnswer = computed(() => {
  const ex = exercise.value;
  if (!ex) return "";
  if (ex.kind === "choice")
    return (
      ex.options
        ?.filter((option) => ex.correctOptionIds?.includes(option.id))
        .map((option) => option.text)
        .join(" / ") || ""
    );
  if (ex.kind === "order")
    return (
      ex.correctTokenIds
        ?.map((id) => ex.tokens?.find((token) => token.id === id)?.text || "")
        .join(" ")
        .replace(/\s+([.,!?])/g, "$1") || ""
    );
  return ex.acceptedAnswers.join(" / ");
});
onMounted(() => {
  const probe = document.createElement("div");
  probe.style.cssText =
    "display:flex;flex-direction:column;row-gap:1px;position:absolute;top:-9999px";
  probe.append(document.createElement("div"), document.createElement("div"));
  document.body.appendChild(probe);
  document.documentElement.classList.toggle(
    "no-flex-gap",
    probe.scrollHeight !== 1,
  );
  probe.remove();
});
watch(
  () => exercise.value?.id,
  () => {
    referenceRevealed.value = false;
  },
);
watch(
  () => app.course.id,
  () => {
    block.value = app.course.turns[0]?.block ?? "A";
    checkedTranscript.value = false;
  },
);
watch(
  () => app.learner?.id,
  () => {
    checkedTranscript.value = false;
  },
);
async function navigate(view: LearningUI["view"]["value"]) {
  if (view === "settings" && app.view !== "settings")
    settingsOrigin.value = app.view;
  const wasParentMode = parentMode.value;
  if (view === "parent" && !parentMode.value) {
    learningView.value = ["home", "lesson", "review", "progress"].includes(
      app.view,
    )
      ? app.view
      : "home";
    learningScroll.value = app.view === "practice" ? 0 : window.scrollY;
  }
  if (view !== "settings") parentMode.value = view === "parent";
  void app.stopSpeech();
  app.refreshLearning();
  if (view === "lesson") {
    await app.openLesson();
    if (app.view !== "lesson") {
      parentMode.value = wasParentMode;
      return;
    }
  } else app.view = view;
  await nextTick();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function selectParentTab(tab: ParentTab) {
  if (tab === "course") managedCourseId.value = null;
  parentTab.value = tab;
  navigate("parent");
}
async function switchSpace() {
  if (app.view === "settings" && parentMode.value) {
    await returnFromSettings();
  } else if (app.view === "practice") {
    exitDestination.value = "parent";
    exitPractice.value = true;
  } else if (parentMode.value) {
    await navigate(learningView.value);
    window.scrollTo({ top: learningScroll.value, behavior: "instant" });
  } else selectParentTab("overview");
}
async function returnFromSettings() {
  await navigate(parentMode.value ? "parent" : settingsOrigin.value);
}
async function handleBack() {
  if (handlingBack || app.busy || !app.ready) return;
  handlingBack = true;
  try {
    const closeImage = document.querySelector<HTMLButtonElement>(
      ".image-backdrop .image-close",
    );
    if (closeImage) {
      closeImage.click();
      return;
    }
    if (imagePreview.value) {
      imagePreview.value = null;
      return;
    }
    if (exitPractice.value) {
      exitPractice.value = false;
      return;
    }
    if (app.view === "settings") {
      await returnFromSettings();
      return;
    }
    if (app.view === "practice") {
      exitDestination.value = "home";
      exitPractice.value = true;
      return;
    }
    if (parentMode.value) {
      if (await parentSpace.value?.handleBack()) return;
      if (parentTab.value !== "overview") selectParentTab("overview");
      else await switchSpace();
      return;
    }
    if (app.view !== "home") await navigate("home");
    else if (isAndroid) await native.exitApp();
  } finally {
    handlingBack = false;
  }
}
async function createProfile() {
  if (!nickname.value.trim() || app.busy) return;
  await app.addLearner(nickname.value.trim());
  if (!app.error) {
    nickname.value = "";
  }
}
function chooseOption(id: string) {
  if (app.feedback) return;
  if ((exercise.value?.correctOptionIds?.length || 0) > 1)
    app.selectedIds = app.selectedIds.includes(id)
      ? app.selectedIds.filter((item) => item !== id)
      : [...app.selectedIds, id];
  else app.selectedIds = [id];
}
function addToken(id: string) {
  if (!app.feedback && !app.selectedIds.includes(id))
    app.selectedIds = [...app.selectedIds, id];
}
function removeToken(id: string) {
  if (!app.feedback)
    app.selectedIds = app.selectedIds.filter((item) => item !== id);
}
async function showReference() {
  await app.revealReference();
  if (!app.error && app.hintShown) referenceRevealed.value = true;
}
async function leavePractice() {
  if (app.recording) await app.toggleRecording();
  exitPractice.value = false;
  navigate(exitDestination.value);
  exitDestination.value = "home";
}
function skillTitle(skill: SkillState) {
  return (
    app.history.find(
      (item) =>
        item.exercise.target.knowledgeId === skill.knowledgeId &&
        item.exercise.target.ability === skill.ability,
    )?.exercise.title || "本课学习目标"
  );
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <button
          class="brand-symbol"
          :aria-label="parentMode ? '切换到学习空间' : '切换到家长空间'"
          :title="parentMode ? '切换到学习空间' : '切换到家长空间'"
          :disabled="!app.ready || app.busy"
          @click="switchSpace"
        >
          <Icon :name="parentMode ? 'shield' : 'leaf'" :size="24" /></button
        ><span
          ><strong>LingoNest<span class="brand-dot">.</span></strong
          ><small>{{ parentMode ? "家长空间" : "英语小窝" }}</small></span
        >
      </div>
      <div class="topbar-actions">
        <button
          v-if="parentMode && app.learner"
          class="profile-chip parent-profile-chip"
          aria-label="管理孩子档案"
          @click="selectParentTab('profiles')"
          :disabled="app.busy"
        >
          <span class="avatar-mini">{{ app.learner.nickname.slice(0, 1) }}</span
          >{{ app.learner.nickname }}
        </button>
        <span v-else-if="app.learner" class="profile-chip"
          ><span class="avatar-mini">{{
            app.learner.nickname.slice(0, 1)
          }}</span
          >{{ app.learner.nickname }}</span
        ><button
          class="icon-button"
          aria-label="设置"
          :disabled="app.view === 'practice'"
          @click="navigate('settings')"
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
    <div v-if="app.error" class="message-bar error-bar" role="alert">
      <Icon name="light" /><span>{{ app.error }}</span
      ><button
        class="icon-button"
        aria-label="关闭错误提示"
        @click="app.dismissError"
      >
        <Icon name="close" :size="17" />
      </button>
    </div>
    <div v-if="app.notice" class="message-bar notice-bar" role="status">
      <Icon name="check" :size="18" /><span>{{ app.notice }}</span>
    </div>
    <div v-if="app.busy" class="busy-indicator" role="status">
      <span class="spinner" />正在保存，请稍候…
    </div>
    <div
      v-if="app.speech.phase !== 'idle'"
      class="speech-status-bar"
      role="status"
    >
      <span>{{
        app.speech.phase === "generating"
          ? "正在生成 AI 语音…"
          : app.speech.lastSource === "course"
            ? "正在播放课程音频"
            : app.speech.lastCached
              ? "正在播放本地缓存语音"
              : "正在朗读…"
      }}</span
      ><button class="text-button" @click="app.stopSpeech">
        {{ app.speech.phase === "generating" ? "取消" : "停止" }}
      </button>
    </div>
    <div
      v-if="app.speech.courseGenerating"
      class="speech-status-bar course-generation-bar"
      role="status"
    >
      <span
        >正在生成课程音频 {{ app.speech.courseProgress.completed }} /
        {{ app.speech.courseProgress.total }}</span
      ><button class="text-button" @click="app.speech.cancelCourse">
        暂停
      </button>
    </div>
    <ParentSpace
      v-if="app.ready && parentMode"
      ref="parentSpace"
      v-show="app.view === 'parent'"
      v-model:tab="parentTab"
      v-model:course-id="managedCourseId"
      :app="app"
      :active="app.view === 'parent'"
      @settings="navigate('settings')"
      @image="imagePreview = $event"
    />
    <main v-if="!app.ready" class="loading-page">
      <span class="spinner large" />
      <h1>正在整理你的小窝</h1>
      <p>课文和学习记录马上就好。</p>
    </main>
    <main
      v-else-if="
        !app.learner && app.view !== 'parent' && app.view !== 'settings'
      "
      class="welcome-page"
    >
      <div class="welcome-art">
        <Icon name="book" :size="68" /><span class="tiny-spark">✦</span>
      </div>
      <span class="eyebrow">A LITTLE EVERY DAY</span>
      <h1>让英语，在小窝里<br />慢慢长大。</h1>
      <p>读懂一段对话，试着说出来，<br />再把学会的留在记忆里。</p>
      <form class="onboarding-form" @submit.prevent="createProfile">
        <label for="first-nickname">先给自己起个昵称</label
        ><input
          id="first-nickname"
          v-model="nickname"
          maxlength="16"
          placeholder="例如：小树"
          autocomplete="off"
          required
        /><button
          class="button primary full-width"
          :disabled="!nickname.trim() || app.busy"
        >
          建立我的小窝 <Icon name="arrow" />
        </button>
      </form>
      <p class="quiet-note">
        <Icon name="shield" :size="15" />不需要真实姓名，学习记录保存在本机。
      </p>
    </main>

    <main v-else-if="app.view === 'home' && app.learner" class="page home-page">
      <section class="page-intro">
        <div>
          <span class="eyebrow">YOUR LITTLE LEARNING NEST</span>
          <h1>
            你好，{{ app.learner.nickname }}<span class="greeting-leaf">✦</span>
          </h1>
          <p>每天一小步，英语更熟悉一点。</p>
        </div>
        <span class="today-badge"
          ><Icon name="leaf" :size="16" />慢慢来，也很棒</span
        >
      </section>
      <section class="hero-card">
        <div class="hero-copy">
          <span class="light-eyebrow"
            >本次学习 · {{ app.course.subtitle }}</span
          >
          <h2>{{ app.course.title }}</h2>
          <p>{{ app.course.subtitle }}</p>
          <button
            v-if="!app.confirmed"
            class="button cream"
            @click="navigate('lesson')"
          >
            先来认识这篇课文 <Icon name="arrow" /></button
          ><button
            v-else-if="nextStage"
            class="button cream"
            :disabled="app.busy"
            @click="app.startStage(nextStage.id)"
          >
            继续{{ nextStage.title }} <Icon name="arrow" /></button
          ><span class="hero-caption">七步学习 · 从读懂，到会用</span>
        </div>
        <svg
          class="hero-illustration"
          viewBox="0 0 270 215"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="151" cy="102" r="88" fill="#fff" opacity=".06" />
          <path
            d="M54 148c41 40 135 40 178-1M68 167c35 25 108 26 149-1M89 185c25 12 66 13 103-1"
            stroke="#D5BA85"
            stroke-width="7"
            stroke-linecap="round"
          />
          <path
            d="M125 141c-30-5-45-28-33-52 8-17 28-19 39-11 10-32 57-30 67-6 18 40-6 77-49 73"
            fill="#F3D79D"
          />
          <path d="M142 102c-24 3-25 28-4 32" fill="#DBAD60" />
          <circle cx="170" cy="80" r="4" fill="#244B3C" />
          <path d="m190 84 20 9-20 7" fill="#E58C59" />
          <path d="m91 132-22-19 26-3" fill="#F3D79D" />
          <path
            d="M62 59c0 20 9 34 24 43M61 59c-19 0-18 20 3 21M63 67c18-18 27 2 9 14"
            stroke="#AAC5A9"
            stroke-width="4"
            stroke-linecap="round"
          />
          <path d="m213 38 2 8 8 2-8 3-2 8-3-8-8-3 8-2 3-8Z" fill="#F5DFC0" />
          <circle cx="107" cy="38" r="3" fill="#F5DFC0" />
        </svg>
      </section>
      <section class="quick-stats" aria-label="今日学习概况">
        <div>
          <span class="stat-icon peach"><Icon name="check" /></span
          ><span
            ><strong>{{ app.stats.todayAttempts }}</strong
            ><small>今天的练习</small></span
          >
        </div>
        <div>
          <span class="stat-icon sage"><Icon name="repeat" /></span
          ><span
            ><strong>{{ app.stats.dueCount }}</strong
            ><small>待复习目标</small></span
          >
        </div>
        <div>
          <span class="stat-icon sand"><Icon name="mic" /></span
          ><span
            ><strong>{{ app.stats.pendingReviews }}</strong
            ><small>口语待确认</small></span
          >
        </div>
      </section>
      <div class="home-columns">
        <section class="section-panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">YOUR LEARNING PATH</span>
              <h2>这节课，七步走</h2>
            </div>
            <span class="muted small"
              >{{ app.stats.completedStages }} /
              {{ app.stages.length }} 已完成</span
            >
          </div>
          <p v-if="!app.confirmed" class="inline-note">
            先和家长核对课文，确认后就可以开始练习。
          </p>
          <div class="stage-list">
            <button
              v-for="(stage, index) in app.stages"
              :key="stage.id"
              class="stage-row"
              :class="{ 'stage-locked': !stage.available || !app.confirmed }"
              :disabled="app.busy || !stage.available || !app.confirmed"
              @click="app.startStage(stage.id)"
            >
              <span class="stage-number"
                ><Icon v-if="stage.verified" name="check" :size="19" /><template
                  v-else
                  >{{ String(index + 1).padStart(2, "0") }}</template
                ></span
              ><span class="stage-copy"
                ><strong>{{ stage.title }}</strong
                ><small>{{ stage.subtitle }}</small></span
              ><span class="stage-status"
                ><span v-if="stage.verified" class="tag green">已验证</span
                ><span
                  v-else-if="stage.done >= stage.total && stage.total > 0"
                  class="tag amber"
                  >完成 · 待验证</span
                ><span v-else-if="stage.done > 0" class="muted small"
                  >{{ stage.done }}/{{ stage.total }}</span
                ><Icon
                  v-else-if="stage.available && app.confirmed"
                  name="chevron"
                  :size="18" /><span v-else class="lock-dot"
              /></span>
            </button>
          </div>
        </section>
        <aside class="home-aside">
          <section class="note-card peach-card">
            <span class="circle-icon"><Icon name="repeat" :size="24" /></span>
            <h3>学过的，再见一面</h3>
            <p>
              {{
                app.stats.dueCount
                  ? `有 ${app.stats.dueCount} 个目标等你复习。隔一段时间再试，记忆更牢固。`
                  : "到时间，小窝会把学过的带回来。今天先安心学习新内容。"
              }}
            </p>
            <button class="text-button" @click="navigate('review')">
              去复习小站 <Icon name="arrow" :size="17" />
            </button>
          </section>
          <section class="note-card">
            <div class="small-label">
              <Icon name="shield" :size="17" />给陪伴学习的大人
            </div>
            <p>练习完成和真正掌握分别记录。口语要听过录音，再由家长确认。</p>
            <button class="text-button" @click="selectParentTab('overview')">
              进入家长空间 <Icon name="arrow" :size="17" />
            </button>
          </section>
        </aside>
      </div>
    </main>

    <main v-else-if="app.view === 'lesson'" class="page lesson-page">
      <section class="page-intro">
        <div>
          <span class="eyebrow">READ & DISCOVER</span>
          <h1>先读懂，再开口</h1>
          <p>{{ app.course.description }}</p>
        </div>
        <span class="tag" :class="app.confirmed ? 'green' : 'amber'">{{
          app.confirmed ? "本档案已核对" : "等待家长核对"
        }}</span>
      </section>
      <section class="source-panel">
        <div>
          <h2>对照原图，确认课文</h2>
          <p>
            本课有
            {{ app.course.turns.length }} 个段落或话轮。请核对文字、角色和顺序。
          </p>
        </div>
        <SourceImages :images="app.sourceImages" />
      </section>
      <div class="lesson-toolbar">
        <div class="segmented" aria-label="课文分段">
          <button
            v-for="part in (['A', 'B', 'C'] as const).filter((part) =>
              app.course.turns.some((turn) => turn.block === part),
            )"
            :key="part"
            :class="{ active: block === part }"
            @click="block = part"
          >
            对话 {{ part }}
          </button>
        </div>
        <button
          class="text-button"
          :disabled="app.busy"
          @click="app.speak(turns.map((turn) => turn.text).join(' '))"
        >
          <Icon name="volume" :size="18" />朗读这一段
        </button>
      </div>
      <section class="dialogue-card">
        <div class="dialogue-heading">
          <span class="chapter-label">{{ block }}</span>
          <div>
            <h2>
              {{
                app.course.id === "starter.unit1.lesson1"
                  ? blockNames[block]
                  : `${block} 段课文`
              }}
            </h2>
            <p>逐句理解，不着急背下来。</p>
          </div>
        </div>
        <ol class="dialogue-list">
          <li v-for="turn in turns" :key="turn.id">
            <span class="speaker-avatar">{{ turn.speaker.slice(0, 1) }}</span>
            <div class="dialogue-content">
              <span class="speaker-name">{{ turn.speaker }}</span>
              <p lang="en" class="english-text">{{ turn.text }}</p>
              <p class="translation">{{ turn.translation }}</p>
            </div>
            <button
              class="icon-button"
              :aria-label="`朗读 ${turn.speaker} 的这句话`"
              @click="app.speak(turn.text)"
            >
              <Icon name="volume" :size="19" />
            </button>
          </li>
        </ol>
      </section>
      <p class="quiet-note device-note">
        <Icon name="volume" :size="15" />{{ app.speech.label }}
      </p>
      <button
        v-if="app.speech.phase !== 'idle'"
        class="button secondary compact"
        @click="app.stopSpeech"
      >
        {{ app.speech.phase === "generating" ? "取消语音生成" : "停止播放" }}
      </button>
      <section v-if="!app.confirmed" class="confirm-course">
        <label class="checkbox-label"
          ><input v-model="checkedTranscript" type="checkbox" /><span
            >我是陪伴学习的家长，已对照原图核对上述课文。</span
          ></label
        ><button
          class="button primary"
          :disabled="!checkedTranscript || app.busy"
          @click="app.confirmCourse"
        >
          确认课文，准备学习 <Icon name="check" :size="18" />
        </button>
      </section>
      <button v-else class="button primary" @click="navigate('home')">
        回到学习路线 <Icon name="arrow" :size="18" />
      </button>
    </main>

    <main v-else-if="app.view === 'practice'" class="page practice-page">
      <div class="practice-top">
        <button class="text-button muted" @click="exitPractice = true">
          <Icon name="close" :size="19" />暂时退出</button
        ><span>{{ app.practice.label }}</span
        ><span class="practice-counter"
          >{{ Math.min(app.practice.position + 1, app.practice.total) }} /
          {{ app.practice.total }}</span
        >
      </div>
      <div class="progress-track">
        <span
          :style="{
            width: `${app.practice.total ? (app.practice.finished ? 100 : (app.practice.position / app.practice.total) * 100) : 0}%`,
          }"
        />
      </div>
      <section v-if="app.practice.finished" class="practice-finished">
        <span class="completion-symbol"><Icon name="check" :size="36" /></span
        ><span class="eyebrow">ONE MORE LITTLE STEP</span>
        <h1>这轮练习，收好了。</h1>
        <p>
          已经提交的作答保存在小窝里。<br />继续看看哪些已验证，哪些还值得再练习。
        </p>
        <p v-if="app.stats.pendingReviews" class="inline-note">
          有 {{ app.stats.pendingReviews }} 条录音等待家长确认。
        </p>
        <div class="button-group">
          <button class="button primary" @click="navigate('home')">
            回到学习路线 <Icon name="arrow" :size="18" /></button
          ><button class="button secondary" @click="navigate('progress')">
            看看我的成长
          </button>
        </div>
      </section>
      <form
        v-else-if="exercise"
        class="exercise-card"
        @submit.prevent="app.submit"
      >
        <span class="exercise-type"
          ><Icon
            :name="
              exercise.kind === 'oral'
                ? 'mic'
                : exercise.kind === 'choice'
                  ? 'light'
                  : 'book'
            "
            :size="17"
          />{{ exercise.title }}</span
        >
        <h1>
          {{
            exercise.stageId === "S6" && exercise.speakText
              ? "先播放题目音频，再听写完整句子。"
              : exercise.instruction
          }}
        </h1>
        <p
          class="exercise-prompt"
          :class="{ 'english-text': /^[A-Za-z]/.test(exercise.prompt) }"
        >
          {{ exercise.prompt }}
        </p>
        <button
          v-if="exercise.speakText && exercise.stageId !== 'S5'"
          type="button"
          class="audio-prompt"
          :disabled="app.recording || app.busy || !!app.feedback"
          @click="app.speak(exercise.speakText)"
        >
          <span class="audio-circle"><Icon name="volume" /></span
          ><span
            ><strong>{{
              exercise.stageId === "S4" ? "听一遍示范" : "播放题目音频"
            }}</strong
            ><small>{{ app.speech.label }}</small></span
          >
        </button>
        <div v-if="exercise.kind === 'choice'" class="choice-options">
          <button
            v-for="(option, index) in exercise.options"
            :key="option.id"
            type="button"
            class="choice-option"
            :class="{ selected: app.selectedIds.includes(option.id) }"
            :disabled="!!app.feedback || app.busy"
            :aria-pressed="app.selectedIds.includes(option.id)"
            @click="chooseOption(option.id)"
          >
            <span class="option-letter">{{
              String.fromCharCode(65 + index)
            }}</span
            ><span>{{ option.text }}</span
            ><Icon
              v-if="app.selectedIds.includes(option.id)"
              name="check"
              :size="20"
            />
          </button>
        </div>
        <div v-else-if="exercise.kind === 'order'" class="order-exercise">
          <div class="token-answer" aria-label="你的句子">
            <span v-if="!orderedTokens.length" class="answer-placeholder"
              >点选下方词块，把句子排出来</span
            ><button
              v-for="token in orderedTokens"
              :key="token.id"
              type="button"
              class="token chosen"
              :disabled="!!app.feedback || app.busy"
              @click="removeToken(token.id)"
            >
              {{ token.text }}<Icon name="close" :size="12" />
            </button>
          </div>
          <div class="token-bank">
            <button
              v-for="token in exercise.tokens"
              :key="token.id"
              type="button"
              class="token"
              :disabled="
                app.selectedIds.includes(token.id) || !!app.feedback || app.busy
              "
              @click="addToken(token.id)"
            >
              {{ token.text }}
            </button>
          </div>
          <p class="field-help">点一下上方的词块，就可以撤回重排。</p>
        </div>
        <div v-else-if="exercise.kind === 'oral'" class="oral-exercise">
          <div
            v-if="oralReferenceVisible && exercise.referenceText"
            class="reference-box"
          >
            <span class="small-label">{{
              exercise.stageId === "S4"
                ? "看着课文，独立朗读"
                : "参考原文 · 本次计为练习"
            }}</span>
            <p lang="en">{{ exercise.referenceText }}</p>
          </div>
          <button
            v-if="
              exercise.stageId === 'S5' && !referenceRevealed && !app.feedback
            "
            type="button"
            class="text-button"
            :disabled="app.busy || app.recording"
            @click="showReference"
          >
            <Icon name="book" :size="17" />想不起来？查看原文
          </button>
          <div class="recording-area">
            <button
              type="button"
              class="record-button"
              :class="{ recording: app.recording }"
              :disabled="app.busy || !!app.feedback"
              @click="app.toggleRecording"
            >
              <Icon :name="app.recording ? 'stop' : 'mic'" :size="30" /></button
            ><strong>{{
              app.recording
                ? "正在录音，点一下结束"
                : app.recordingPath
                  ? "录音已保存，可以回听"
                  : "准备好了，就开始录音"
            }}</strong
            ><small>{{
              app.recording
                ? "请保持页面打开，让声音完整录下来。"
                : "这里只保存录音，不自动评价发音。"
            }}</small
            ><button
              v-if="app.recordingPath && !app.recording"
              type="button"
              class="button secondary compact"
              @click="app.playRecording(app.recordingPath)"
            >
              <Icon name="play" :size="17" />回听我的录音
            </button>
          </div>
        </div>
        <div v-else class="written-answer">
          <label for="exercise-answer">{{
            exercise.kind === "spelling" ? "写出这个单词" : "写出你的答案"
          }}</label
          ><input
            v-if="exercise.kind === 'spelling'"
            id="exercise-answer"
            v-model="app.answer"
            lang="en"
            inputmode="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            :spellcheck="false"
            :disabled="!!app.feedback || app.busy"
            placeholder="Type your answer…"
          /><textarea
            v-else
            id="exercise-answer"
            v-model="app.answer"
            lang="en"
            rows="3"
            inputmode="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            :spellcheck="false"
            :disabled="!!app.feedback || app.busy"
            placeholder="Type your answer here…"
          />
          <p class="field-help">可以慢慢想，提交前都能修改。</p>
        </div>
        <div v-if="app.hintShown && !app.feedback" class="hint-box">
          <Icon name="light" :size="18" /><span
            >{{ exercise.hint
            }}<small>用了提示，这次作为练习记录。</small></span
          >
        </div>
        <div
          v-if="app.feedback"
          class="feedback-box"
          :class="
            app.feedback.status === 'needs_review'
              ? 'feedback-pending'
              : app.feedback.passed
                ? 'feedback-success'
                : 'feedback-retry'
          "
          aria-live="polite"
        >
          <span class="feedback-icon"
            ><Icon
              :name="
                app.feedback.status === 'needs_review'
                  ? 'clock'
                  : app.feedback.passed
                    ? 'check'
                    : 'light'
              "
              :size="23"
          /></span>
          <div>
            <h2>
              {{
                app.feedback.status === "needs_review"
                  ? "录音收到了，等大人来听听"
                  : app.feedback.status === "unscorable"
                    ? "这次暂时无法评价"
                    : app.feedback.passed
                      ? "做到了，继续保持！"
                      : "找到一个可以进步的地方"
              }}
            </h2>
            <p>{{ app.feedback.feedback }}</p>
            <p
              v-if="
                app.feedback.status === 'scored' && app.feedback.score !== null
              "
              class="feedback-score"
            >
              本次{{
                app.feedback.source === "human" ? "人工确认" : "练习"
              }}：{{ Math.round(app.feedback.score * 100) / 100 }} 分
            </p>
            <div
              v-if="exercise.kind !== 'oral' && feedbackAnswer"
              class="feedback-answer"
            >
              <span>参考答案</span
              ><strong lang="en">{{ feedbackAnswer }}</strong>
            </div>
          </div>
        </div>
        <div class="exercise-actions">
          <button
            v-if="!app.feedback"
            type="button"
            class="text-button muted"
            :disabled="app.hintShown || app.busy || app.recording"
            @click="app.revealHint"
          >
            <Icon name="light" :size="18" />{{
              app.hintShown ? "已使用提示" : "给我一点提示"
            }}</button
          ><span v-else class="small muted">已提交的作答已保存</span
          ><button
            v-if="!app.feedback"
            type="submit"
            class="button primary"
            :disabled="!canSubmit"
          >
            {{ exercise.kind === "oral" ? "提交录音" : "提交答案" }}
            <Icon name="arrow" :size="18" /></button
          ><button
            v-else
            type="button"
            class="button primary"
            :disabled="app.busy"
            @click="app.next"
          >
            {{ isLast ? "完成这一轮" : "下一题" }}
            <Icon name="arrow" :size="18" />
          </button>
        </div>
      </form>
      <section v-else class="empty-state">
        <Icon name="book" :size="42" />
        <h2>这次没有可开始的题目</h2>
        <p>回到学习路线，选择一个可用阶段。</p>
        <button class="button primary" @click="navigate('home')">
          返回学习路线
        </button>
      </section>
    </main>

    <main v-else-if="app.view === 'review'" class="page review-page">
      <section class="page-intro">
        <div>
          <span class="eyebrow">MAKE IT STICK</span>
          <h1>复习小站</h1>
          <p>隔一段时间再想起来，才是真的记住。</p>
        </div>
        <span class="circle-icon"><Icon name="repeat" :size="27" /></span>
      </section>
      <section class="review-hero">
        <div>
          <span class="eyebrow">TODAY'S REVIEW</span>
          <h2 v-if="app.stats.dueCount">
            有 <em>{{ app.stats.dueCount }}</em> 个目标，等你再试一次
          </h2>
          <h2 v-else>今天的复习，可以从容一点</h2>
          <p>
            {{
              app.stats.dueCount
                ? "小窝会根据你的作答安排复习。未到复测时间的内容，会继续等待。"
                : "暂时没有到期任务。去学一点新的，或者休息一下。"
            }}
          </p>
          <button
            v-if="app.stats.dueCount"
            class="button primary"
            :disabled="app.busy || !app.confirmed"
            @click="app.startReview"
          >
            开始今天的复习 <Icon name="arrow" :size="18" /></button
          ><button v-else class="button primary" @click="navigate('home')">
            回到学习路线 <Icon name="arrow" :size="18" />
          </button>
        </div>
        <Icon name="leaf" :size="86" />
      </section>
      <section v-if="dueSkills.length" class="section-panel">
        <div class="section-heading"><h2>这些内容值得再练一练</h2></div>
        <div v-for="skill in dueSkills" :key="skill.key" class="skill-row">
          <span class="skill-bullet"><Icon name="repeat" :size="18" /></span>
          <div>
            <strong>{{ skillTitle(skill) }}</strong
            ><small
              >{{ abilityLabels[skill.ability]
              }}<template
                v-if="
                  skill.eligibleAt &&
                  new Date(skill.eligibleAt).getTime() > Date.now()
                "
              >
                · {{ shortDate(skill.eligibleAt) }} 后复测</template
              ></small
            >
          </div>
          <span class="tag amber">待复习</span>
        </div>
      </section>
      <section v-if="app.stats.pendingReviews" class="pending-banner">
        <Icon name="mic" :size="24" />
        <div>
          <h3>还有 {{ app.stats.pendingReviews }} 条口语待确认</h3>
          <p>等待评价不会当成答错，邀请家长听听录音吧。</p>
        </div>
        <button
          class="button secondary compact"
          @click="selectParentTab('confirm')"
        >
          去确认
        </button>
      </section>
      <p class="quiet-note">
        已经做过，也可能还需要跨日复测。学习完成与掌握始终分开。
      </p>
    </main>

    <main v-else-if="app.view === 'progress'" class="page progress-page">
      <section class="page-intro">
        <div>
          <span class="eyebrow">LITTLE STEPS, REAL GROWTH</span>
          <h1>看见自己的成长</h1>
          <p>记录每一次尝试，也认真对待“还没学会”。</p>
        </div>
      </section>
      <div class="growth-grid">
        <section class="growth-card">
          <span class="small-label">这节课的训练进度</span>
          <h2>
            {{ app.stats.completedStages
            }}<small> / {{ app.stages.length }} 阶段</small>
          </h2>
          <div class="progress-track">
            <span :style="{ width: `${completedPercent}%` }" />
          </div>
          <p>表示任务完成，不代表已经掌握。</p>
        </section>
        <section class="growth-card green-card">
          <span class="small-label">已经达到掌握门槛</span>
          <h2>{{ app.stats.mastered }}<small> 个目标</small></h2>
          <p>已测 {{ app.stats.measured }} 个目标 · 还会继续跨日复习。</p>
        </section>
      </div>
      <section class="section-panel">
        <div class="section-heading">
          <h2>各项能力，慢慢积累</h2>
          <span class="muted small">按真实作答更新</span>
        </div>
        <div
          v-if="!app.skills.length || !app.stats.measured"
          class="empty-state compact-empty"
        >
          <Icon name="leaf" :size="37" />
          <h3>成长从第一次尝试开始</h3>
          <p>完成一次无提示练习，这里就会留下学习的足迹。</p>
          <button class="text-button" @click="navigate('home')">
            去学习 <Icon name="arrow" :size="17" />
          </button>
        </div>
        <div
          v-for="skill in app.skills.filter(
            (item) => item.status !== 'unmeasured',
          )"
          :key="skill.key"
          class="skill-row"
        >
          <span class="skill-bullet"
            ><Icon
              :name="skill.status === 'mastered' ? 'check' : 'leaf'"
              :size="18"
          /></span>
          <div>
            <strong>{{ skillTitle(skill) }}</strong
            ><small
              >{{ abilityLabels[skill.ability] }} ·
              {{ skill.evidenceCount }} 次有效记录</small
            >
          </div>
          <span
            class="tag"
            :class="
              skill.status === 'mastered'
                ? 'green'
                : skill.status === 'review_due'
                  ? 'amber'
                  : 'neutral'
            "
            >{{ statusLabels[skill.status] }}</span
          >
        </div>
      </section>
      <section v-if="newestHistory.length" class="section-panel">
        <div class="section-heading"><h2>最近的练习</h2></div>
        <div v-for="item in newestHistory" :key="item.id" class="history-row">
          <span
            class="history-mark"
            :class="
              item.grade.status === 'needs_review'
                ? 'amber'
                : item.grade.passed
                  ? 'green'
                  : 'neutral'
            "
            ><Icon
              :name="
                item.grade.status === 'needs_review'
                  ? 'clock'
                  : item.grade.passed
                    ? 'check'
                    : 'light'
              "
              :size="17"
          /></span>
          <div>
            <strong>{{ item.exercise.title }}</strong
            ><small
              >{{ shortDate(item.submittedAt)
              }}<template v-if="item.hintLevel > 0">
                · 提示练习</template
              ></small
            >
          </div>
          <span class="small muted">{{
            item.grade.status === "needs_review"
              ? "待人工确认"
              : item.grade.status === "unscorable"
                ? "暂不可评价"
                : item.grade.passed
                  ? "本次通过"
                  : "继续练习"
          }}</span>
        </div>
      </section>
    </main>

    <main v-else-if="app.view === 'settings'" class="page settings-page">
      <section class="page-intro">
        <div>
          <span class="eyebrow">A SAFE LITTLE NEST</span>
          <h1>小窝设置</h1>
          <p>管理语音、文字识别与课程生成模型。</p>
        </div>
        <button class="text-button" @click="returnFromSettings">
          {{ parentMode ? "返回家长空间" : "返回学习空间" }}
          <Icon name="arrow" :size="17" />
        </button>
      </section>
      <section class="section-panel">
        <div class="section-heading">
          <h2>孩子档案</h2>
          <button class="text-button" @click="selectParentTab('profiles')">
            管理孩子档案 <Icon name="arrow" :size="17" />
          </button>
        </div>
        <p class="field-help">在家长空间创建、切换和管理孩子的学习档案。</p>
      </section>
      <SpeechSettings :speech="app.speech" />
      <ContentSettings />
      <section class="storage-note">
        <Icon name="shield" :size="21" />
        <div>
          <strong>{{ app.storageLabel }}</strong>
          <p>
            朗读方式、模型、音色和语速可在此设置。录音只会在你点击开始后采集。
          </p>
        </div>
      </section>
    </main>

    <nav
      v-if="app.ready && parentMode"
      class="bottom-nav"
      aria-label="家长导航"
    >
      <button
        v-for="item in parentNav"
        :key="item.id"
        :class="{ active: app.view === 'parent' && parentTab === item.id }"
        :aria-current="
          app.view === 'parent' && parentTab === item.id ? 'page' : undefined
        "
        @click="selectParentTab(item.id)"
      >
        <span><Icon :name="item.icon" :size="21" /></span>{{ item.label
        }}<i v-if="item.id === 'confirm' && app.pending.length" />
      </button>
    </nav>
    <nav
      v-else-if="app.ready && app.learner && app.view !== 'practice'"
      class="bottom-nav"
      aria-label="主导航"
    >
      <button
        v-for="item in nav"
        :key="item.id"
        :class="{ active: app.view === item.id }"
        :aria-current="app.view === item.id ? 'page' : undefined"
        @click="navigate(item.id)"
      >
        <span><Icon :name="item.icon" :size="21" /></span>{{ item.label
        }}<i v-if="item.id === 'review' && app.stats.dueCount" />
      </button>
    </nav>
    <div
      v-if="imagePreview"
      class="modal-backdrop image-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="课文原图"
      @click.self="imagePreview = null"
    >
      <button
        class="image-close icon-button"
        aria-label="关闭原图"
        @click="imagePreview = null"
      >
        <Icon name="close" :size="24" /></button
      ><img :src="imagePreview" alt="放大的课文原图，请对照核对文字" />
    </div>
    <div
      v-if="exitPractice"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-title"
    >
      <section class="modal-card">
        <span class="circle-icon"><Icon name="book" :size="26" /></span>
        <h2 id="exit-title">先休息一下吗？</h2>
        <p>已经提交的作答会保留。未提交的题目不会被记为完成或答错。</p>
        <p v-if="app.recording" class="inline-note">退出时会先结束当前录音。</p>
        <div class="modal-actions">
          <button
            class="button secondary"
            @click="
              exitPractice = false;
              exitDestination = 'home';
            "
          >
            继续练习</button
          ><button
            class="button primary"
            :disabled="app.busy"
            @click="leavePractice"
          >
            {{
              exitDestination === "parent" ? "保存进度并切换" : "保存进度并退出"
            }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
