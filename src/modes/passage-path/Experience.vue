<script setup lang="ts">
import "./style.css";
import { computed, nextTick, onMounted, onScopeDispose, reactive, ref, watch } from "vue";
import { useExperience, type PassageView } from "./useExperience";
import type { PassageQuestion } from "../../../packages/learning-modes/passage-path/model";
import CourseAudioPanel from "../../components/CourseAudioPanel.vue";
import SourceImages from "../../components/SourceImages.vue";
import CourseModeNotice from "../../components/CourseModeNotice.vue";
import QuestionEditor from "./QuestionEditor.vue";
import OutlineEditor from "./OutlineEditor.vue";
import QuestionInput from "./QuestionInput.vue";
import QuestionPreview from "./QuestionPreview.vue";
import OralPractice from "./OralPractice.vue";
import LessonPath from "./LessonPath.vue";
import { completedLessons, hasCurriculum, lessonTitle, nextLesson, sessionLessonLabel } from "../../../packages/learning-modes/passage-path/curriculum";
import { answerText as answer } from "../../../packages/learning-modes/passage-path/presentation";
import { useWorkspace } from "../../application/workspace";
import { native } from "../../native";
const workspace = useWorkspace();
const app = reactive(useExperience());
const noFlexGap = ref(false);
const authorize = workspace.authorize;
const questionEditor = ref<InstanceType<typeof QuestionEditor> | null>(null);
const outlineEditor = ref<InstanceType<typeof OutlineEditor> | null>(null);
const editingReview = computed(() => app.editingQuestion || app.editingOutline);
const previewOpen = ref(false);
const questionHeading = ref<HTMLElement | null>(null), continueButton = ref<HTMLButtonElement | null>(null), roundHeading = ref<HTMLElement | null>(null);
let focusedStep = "";
const stepKey = () => JSON.stringify([app.session?.id, app.session?.index, app.session?.feedbackAttemptId, app.session?.status]);
watch([workspace.visible, () => app.busy, () => app.view, stepKey], async () => {
  if (!workspace.visible.value || app.view !== "practice") { focusedStep = ""; return; }
  if (app.busy) return;
  const expected = stepKey(); if (focusedStep === expected) return;
  await nextTick();
  if (!workspace.visible.value || app.busy || app.view !== "practice" || stepKey() !== expected) return;
  const target = app.session?.status === "completed" ? roundHeading.value : app.feedback ? continueButton.value : questionHeading.value;
  if (target) { target.focus(); focusedStep = expected; }
}, { flush: "post" });
const roundGoals = computed(() => app.session ? [...new Map(app.session.queue.map(item => {
  const pkg = app.data.packages.find(pkg => pkg.courseId === item.courseId && pkg.revision === item.revision)!;
  const goal = pkg.goals.find(goal => goal.id === pkg.questions.find(question => question.id === item.questionId)!.goalId)!;
  return [pkg.courseId + ':' + goal.id, goal.title] as const;
})).values()] : []);
const publicationComparison = computed(() => {
  const previous = app.data.packages.find(pkg => pkg.courseId === app.managedId && pkg.revision === app.publishedManaged?.revision);
  if (!previous || !app.review || previous.revision === app.review.package.revision) return null;
  return { added: app.review.package.questions.filter(question => !previous.questions.some(item => item.id === question.id)).length,
    changed: app.review.package.questions.filter(question => previous.questions.some(item => item.id === question.id) && JSON.stringify(question) !== JSON.stringify(previous.questions.find(item => item.id === question.id))).length,
    removed: previous.questions.filter(question => !app.review!.package.questions.some(item => item.id === question.id)).length,
    outline: JSON.stringify([previous.chunks, previous.goals, previous.levels]) !== JSON.stringify([app.review.package.chunks, app.review.package.goals, app.review.package.levels]) };
});
const reviewPosition = computed(() => app.reviewQuestions.findIndex(item => item.index === app.reviewIndex));
const currentInGroup = computed(() => app.reviewGroupQuestions.some(item => item.index === app.reviewIndex));
const reviewGoals = computed(() => {
  const level = app.review?.package.levels.find(level => level.id === app.reviewLevel);
  return app.review?.package.goals.filter(goal => !level || [...level.newGoalIds, ...level.reviewGoalIds].includes(goal.id)) ?? [];
});
const groupApproved = computed(() => app.reviewGroupQuestions.filter(({ question }) => app.review!.reviewedQuestionIds.includes(question.id)).length);
function moveReview(direction: number) {
  const item = reviewPosition.value < 0
    ? direction > 0 ? app.reviewQuestions.find(item => item.index > app.reviewIndex) ?? app.reviewQuestions[0] : [...app.reviewQuestions].reverse().find(item => item.index < app.reviewIndex)
    : app.reviewQuestions[reviewPosition.value + direction];
  if (item) app.reviewIndex = item.index;
}
watch(() => app.error, value => { if (workspace.visible.value && app.ready && value) workspace.notify(value, "error"); });
watch(() => app.message, value => { if (workspace.visible.value && value) workspace.notify(value); });
async function enterParent() { await workspace.openParent("authoring"); }
async function openMicrophoneSettings() { await workspace.authorize("开启麦克风权限", async () => { await app.prepareLeave(); await native.openAppSettings(); }); }
async function navigate(view: PassageView) {
  if (view === "settings") { await workspace.openSettings(); return; }
  if (view === "parent") { await enterParent(); return; }
  await app.navigate(view);
}
const original = computed(() => app.view === "practice" ? app.questionPackage : app.pkg);
const canSubmit = computed(() => !app.recording && (app.question?.kind === "speak" ? !!app.response.oral?.listened && !!app.response.oral.selfRating : app.question?.kind === "cloze" ? !!app.response.text.trim() : app.question?.kind === "order" ? app.response.selectedIds.length === app.question.tokens.length : app.response.selectedIds.length > 0 && (app.question?.kind !== "listen-choice" || app.questionPackage?.rules.version !== "3" || app.response.audioPlayed === true)));
async function closePreview() { previewOpen.value = false; await app.candidateAudio.stop(); }
async function playPreview(text: string) { try { await app.candidateAudio.play(text); } catch (failure) { workspace.notify(failure instanceof Error ? failure.message : String(failure), "error"); } }
async function closeOriginal() {
  app.originalOpen = false; await nextTick();
  if (workspace.visible.value && app.view === "practice" && !app.busy) (app.feedback ? continueButton.value : questionHeading.value)?.focus();
}
const completedLevelIds = computed(() => app.data.completions.filter(item => item.learnerId === app.learner?.id && item.courseId === app.courseId && item.revision === app.pkg?.revision).map(item => item.levelId));
const nextLevel = computed(() => app.pkg?.levels.find(level => !completedLevelIds.value.includes(level.id)));
const upcomingLesson = computed(() => app.pkg && nextLevel.value && hasCurriculum(app.pkg) ? nextLesson(app.data, app.learner?.id ?? "", app.pkg, nextLevel.value) : undefined);
const startLabel = computed(() => app.activeRun ? "继续学习" : !nextLevel.value ? "复习本课" : upcomingLesson.value && upcomingLesson.value !== "discover" ? "继续本关" : completedLevelIds.value.length ? "开始下一关" : "开始学习");
const sessionTitle = computed(() => {
  return app.pkg && app.session ? sessionLessonLabel(app.pkg, app.session) : "本课练习";
});
const continueLabel = computed(() => nextLevel.value ? app.session?.lesson && app.session.levelId === nextLevel.value.id ? "继续下一小课" : "进入下一关" : "复习本课");
const recentOralCount = ref(10);
watch(() => JSON.stringify([app.learner?.id, app.courseId]), () => { recentOralCount.value = 10; });
const oralHistory = computed(() => app.data.attempts.filter(attempt => attempt.learnerId === app.learner?.id && attempt.item.courseId === app.courseId && attempt.correct === null).slice().reverse());
const sessionAttempts = computed(() => app.data.attempts.filter(attempt => attempt.sessionId === app.session?.id));
const firstAttempts = computed(() => sessionAttempts.value.filter(attempt => attempt.correct !== null && attempt.item.reason !== "repair"));
const reviewedPublication = computed(() => app.publishedManaged?.revision === app.review?.package.revision);
const reviewComplete = computed(() => app.review && app.review.sourceConfirmed && app.review.package.questions.every(question => app.review!.reviewedQuestionIds.includes(question.id)));
async function submitAnswer() { if (!app.busy && !app.feedback && canSubmit.value) await app.submit(); }
async function prepareLeave() {
  if (previewOpen.value) await closePreview();
  if (app.editingQuestion && questionEditor.value && !(await app.saveQuestion(questionEditor.value.read()))) throw Error(app.error || "本题修改尚未保存。");
  if (app.editingOutline && outlineEditor.value && !(await app.saveOutline(outlineEditor.value.read()))) throw Error(app.error || "知识块修改尚未保存。");
  await app.prepareLeave();
}
async function saveQuestion(question: PassageQuestion) { await app.saveQuestion(question); }
onMounted(() => {
  const probe = document.createElement("div");
  probe.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;top:-9999px";
  probe.append(document.createElement("div"), document.createElement("div")); document.body.appendChild(probe);
  noFlexGap.value = probe.scrollHeight !== 1; probe.remove();
});
let boundActivation = -1;
watch([workspace.surface, workspace.courseId, workspace.visible, workspace.activation, () => app.ready, () => app.busy], async () => {
  if (!app.ready || app.busy || !workspace.visible.value) return;
  if (workspace.surface.value === "authoring") {
    const id = workspace.courseId.value ?? app.courseId;
    if (boundActivation !== workspace.activation.value || app.managedId !== id || app.view !== "parent") {
      boundActivation = workspace.activation.value;
      await app.openManager(id);
    }
  }
  else if (workspace.surface.value === "report") app.view = "report";
  else if (app.view !== "practice" && app.view !== "home" && app.view !== "source") await app.navigate("home");
}, { immediate: true });
onScopeDispose(workspace.connect({
  get ready() { return app.ready; }, get busy() { return app.busy || app.generating || app.processingAudio; },
  get loadError() { return app.ready ? "" : app.error; },
  get focused() { return workspace.surface.value === "learning" && app.view === "practice"; },
  get completed() { return app.view === "practice" && app.session?.status === "completed"; },
  prepareLeave,
  async handleBack() {
    if (previewOpen.value) { await closePreview(); return true; }
    if (app.originalOpen) { await closeOriginal(); return true; }
    if (app.view === "source") { await app.navigate("home"); return true; }
    return false;
  },
  async exit() { await app.prepareLeave(); await app.navigate("home"); },
  refresh: app.refreshContext,
  async readMaterial() { await app.navigate("source"); if (app.error) throw Error(app.error); },
}));
</script>
<template>
  <div class="passage-path-mode" :class="{ 'no-flex-gap': noFlexGap }" :aria-busy="app.busy || app.mode.busy">
    <main v-if="!app.ready" class="passage-card"><p>正在读取课程与学习记录…</p><button v-if="app.error" @click="app.boot">重新读取</button></main>
    <div v-else>
      <nav v-if="workspace.surface.value === 'learning' && app.view !== 'practice'" class="passage-tabs" aria-label="闯关导航">
        <button :aria-current="app.view === 'home' ? 'page' : undefined" :disabled="app.busy" @click="navigate('home')">学习路径</button>
        <button :disabled="app.busy || !app.pkg" @click="navigate('source')">课文原文</button>
      </nav>
      <div v-if="app.playing" class="passage-playback passage-actions"><span role="status">正在播放音频</span><button @click="app.stopPlayback">停止播放</button></div>
      <section v-if="app.view === 'home'" class="passage-stack">
        <CourseModeNotice v-if="!app.pkg" :title="app.course?.title ?? '当前课程'" mode-title="课文闯关" :status="app.candidateAvailable ? 'review' : 'missing'" @prepare="enterParent" />
        <template v-else>
          <section class="passage-card passage-hero">
            <p class="eyebrow">今天的小目标</p><h2>{{ nextLevel?.title ?? '把学过的表达再用一次' }}</h2>
            <p>一轮练几道，理解、组句、回想换着来。想休息时可以保存进度。</p>
            <p v-if="!app.audioAvailable" class="passage-note">本课音频尚未就绪，请家长在课程管理中修复后再学习。</p>
            <p v-if="nextLevel">{{ nextLevel.title }}<template v-if="upcomingLesson"> · 接下来：{{ lessonTitle(upcomingLesson) }}</template></p><p v-else>本课关卡已完成，可以复习或选择另一门课。</p>
            <button class="primary" :disabled="app.busy || !app.learner || !app.audioAvailable" @click="app.start()">{{ startLabel }}</button>
            <button v-if="!app.audioAvailable" @click="enterParent">请家长修复音频</button>
            <p v-if="!hasCurriculum(app.pkg)" class="field-help">本课使用基础短课内容。家长重新生成并审核后，可启用多次短课、情境迁移和听说练习。</p>
          </section>
          <LessonPath :state="app.data" :pkg="app.pkg" :learner-id="app.learner?.id ?? ''" :disabled="app.busy || !app.audioAvailable" @replay="app.start" />
          <section v-if="app.reviewDue" class="passage-card"><h2>隔天回访</h2><p>把“{{ app.reviewDue.goal }}”再用一次，看看今天能否独立想起来。</p><button :disabled="app.busy || !app.audioAvailable" @click="app.start(app.reviewDue!.levelId, app.reviewDue!.lesson)">开始回访短课</button></section>
          <section v-if="app.report" class="passage-card">
            <h2>学习足迹</h2><p>路径 {{ app.report.completedLevels }} / {{ app.report.totalLevels }} · 首次作答 {{ app.report.firstAttemptCount }} 次</p>
            <p v-if="hasCurriculum(app.pkg)">短课 {{ app.report.completedShortLessons }} / {{ app.report.totalShortLessons }} · 口语回听 {{ app.report.oralPracticeCount }} 次</p>
            <p>路径完成表示练过；稳定表现需要在不同日期独立用对。</p>
            <ul><li v-for="goal in app.report.goals" :key="goal.goalId">{{ app.pkg.goals.find(item => item.id === goal.goalId)?.title }} · {{ ({ unseen: '还没练到', practicing: '练习中', weak: '需要巩固', stable: '表现稳定' })[goal.status] }}</li></ul>
          </section>
        </template>
      </section>
      <section v-if="app.view === 'practice'" class="passage-stack">
        <template v-if="app.session?.status === 'active' && app.question">
          <section class="passage-card passage-practice">
            <p class="eyebrow">{{ sessionTitle }}</p>
            <div class="passage-actions"><span>第 {{ app.session.index + 1 }} / {{ app.session.queue.length }} 题</span><span>{{ app.session.baseCount }} 道基础题<template v-if="app.session.queue.length > app.session.baseCount"> · {{ app.session.queue.length - app.session.baseCount }} 道补练</template></span></div>
            <progress class="passage-progress" :value="app.session.index" :max="app.session.queue.length" aria-label="本轮练习进度" />
            <p v-if="app.item?.courseId !== app.courseId" class="eyebrow">穿插复习 · {{ app.questionPackage?.source.title }}</p>
            <p v-if="app.item?.reason === 'repair'" class="eyebrow">再试一次 · 这一轮的补练</p>
            <h1 ref="questionHeading" tabindex="-1">{{ app.question.prompt }}</h1>
            <aside v-if="app.question.context" class="passage-note"><strong>换个情境</strong><p>{{ app.question.context.text }}</p></aside>
            <button v-if="app.question.audioText" :disabled="app.busy || app.recording" @click="app.play(app.question!.audioText!)">{{ app.question.kind === 'speak' ? '听示范表达' : '播放题目音频' }}</button>
            <OralPractice v-if="app.question.kind === 'speak'" :question="app.question" :response="app.response" :recording="app.recording" :disabled="app.busy || !!app.feedback" :microphone-denied="app.microphoneDenied" @record="app.toggleRecording" @hear="app.hearRecording()" @rate="app.rateSpeaking" @settings="openMicrophoneSettings" />
            <p v-if="app.question.kind === 'listen-choice' && app.questionPackage?.rules.version === '3' && !app.response.audioPlayed" class="field-help">请先完整听一遍，再检查答案。</p>
            <QuestionInput v-if="app.question.kind !== 'speak'" v-model="app.response" :question="app.question" :display-ids="app.item!.displayIds" :disabled="app.busy || !!app.feedback" @change="app.inputChanged" @submit="submitAnswer" />
            <div v-if="!app.feedback" class="passage-actions passage-submit-actions"><button class="primary" :disabled="app.busy || !canSubmit" @click="submitAnswer">{{ app.question.kind === 'speak' ? '提交口语练习' : '检查答案' }}</button><button :disabled="app.busy || app.recording" @click="app.reveal('hint')">看提示</button><button :disabled="app.busy || app.recording" @click="app.reveal('source')">查看原文</button></div>
            <p v-if="app.hintOpen && !app.feedback" class="passage-note">{{ app.questionPackage?.chunks.find(chunk => chunk.id === app.questionPackage?.goals.find(goal => goal.id === app.question?.goalId)?.chunkId)?.meaning }} · 本次使用了辅助。</p>
            <div v-if="app.feedback" class="passage-feedback" :class="{ 'is-correct': app.feedback.correct === true, 'needs-practice': app.feedback.correct === false }" role="status"><h2>{{ app.feedback.correct === null ? '口语练习已记录' : app.feedback.correct ? '答对了' : '一起看一看' }}</h2><p>{{ app.feedback.correct === null ? '示范表达' : '参考答案' }}：{{ answer(app.question) }}</p><p>{{ app.question.explanation }}</p><p v-if="app.feedback.correct === null">录音和自评会保留，发音与表达尚未自动判分。<button :disabled="app.busy" @click="app.hearRecording(app.feedback!.response.oral!.recordingPath)">回听本次录音</button></p><p v-if="app.session.queue.length > app.session.baseCount">这一轮加了 {{ app.session.queue.length - app.session.baseCount }} 道补练题，换个问法再试一次。</p><button ref="continueButton" class="primary" :disabled="app.busy" @click="app.next">继续</button></div>
          </section>
        </template>
        <section v-else class="passage-card passage-round-summary"><h1 ref="roundHeading" tabindex="-1">{{ app.session?.status === 'completed' ? '这一轮完成了' : '请重新进入学习' }}</h1>
          <template v-if="app.session?.status === 'completed'"><h2>{{ sessionTitle }}</h2><p>这轮练过：{{ roundGoals.join('、') }}。</p>
            <p v-if="app.summary?.needsPractice.length">建议再巩固：{{ app.summary.needsPractice.map(goal => goal.title).join('、') }}。可以换个问法再试，也可以先休息。</p><p v-else>这次练习已完成，隔天再独立用一次，看看表达是否更熟悉。</p>
            <p v-if="app.summary?.oralCount">完成 {{ app.summary.oralCount }} 次录音回听；口语自评不计作答对或稳定证据。</p>
            <p v-if="nextLevel">接下来：{{ nextLevel.title }}<template v-if="upcomingLesson"> · {{ lessonTitle(upcomingLesson) }}</template></p><p v-else>本课关卡已完成。可以稍后复习，让表达更熟悉。</p>
            <button v-if="app.summary?.suggestRepeat && app.session.lesson" class="primary" :disabled="app.busy || !app.audioAvailable" @click="app.start(app.session!.levelId!, app.session!.lesson)">巩固这一小课</button>
            <button :class="{primary: !app.summary?.suggestRepeat || !app.session.lesson}" :disabled="app.busy || !app.audioAvailable" @click="app.start()">{{ continueLabel }}</button>
            <details class="passage-round-details"><summary>查看本轮记录</summary><p>首次答对 {{ firstAttempts.filter(attempt => attempt.correct).length }} / {{ firstAttempts.length }} · 补练 {{ sessionAttempts.filter(attempt => attempt.item.reason === 'repair').length }} 道</p><p>主动查看辅助 {{ app.session.helpRequests === undefined ? '旧版未记录' : app.session.helpRequests.length + ' 项' }} · 巩固作答 {{ sessionAttempts.filter(attempt => attempt.assisted && attempt.correct !== null).length }} 次。同一题的提示、原文、示范各计一项，整课原文另计一项。详细情况可在学习记录查看。</p><p>路径完成和稳定表现分别记录。</p></details>
          </template><p class="field-help">进度已保存，休息后也能继续。</p><button @click="navigate('home')">返回学习路径</button></section>
      </section>
      <section v-if="app.view === 'source' || app.originalOpen" class="passage-card passage-original">
        <div class="passage-actions"><h2>{{ original?.source.title }} · 原文</h2><button v-if="app.originalOpen" @click="closeOriginal">收起原文</button></div>
        <template v-if="original"><SourceImages :images="original.source.images ?? []" /><div v-for="turn in original.source.turns" :key="turn.id" class="passage-turn"><p><strong v-if="turn.speaker">{{ turn.speaker }}:</strong> {{ turn.text }}</p><button :disabled="app.busy" :aria-label="`朗读原文 ${turn.id}`" @click="app.play(turn.text, original)">听原文</button></div></template>
      </section>
      <section v-show="app.view === 'parent'" class="passage-stack passage-parent" aria-label="课文闯关内容准备">
        <div class="passage-card"><h1>课文闯关内容</h1><p>{{ app.managed?.title }}</p><p v-if="app.publishedManaged">当前开放版本继续可学，新的候选题库单独审核。</p></div>
        <section v-if="app.managed" class="passage-card"><h2>生成候选题库</h2><p>围绕课文中的交流用途编排短关卡。模型生成后还需要完整审核。</p>
          <button v-if="!app.generating" class="primary" :disabled="app.busy || editingReview || app.candidateAudio.courseGenerating" @click="app.generate">{{ app.review ? '重新生成候选题库' : '生成闯关题库' }}</button>
          <button v-else @click="app.cancelGeneration">暂停课程生成</button>
        </section>
        <template v-if="app.review">
          <section class="passage-card"><h2>审核整个候选题库</h2><p>{{ app.review.package.levels.length }} 关 · {{ app.review.package.questions.length }} 道候选题（实际练习按规则选题）</p>
            <p v-if="hasCurriculum(app.review.package)">每关分为初识表达、换情境用、听说应答三次短课。请分别核对各短课覆盖、情境的交流用途、听辨答案和口语回听要点。</p>
            <details class="passage-source-review" :open="!app.review.sourceConfirmed"><summary>完整教材对照</summary><SourceImages :images="app.review.package.source.images ?? []" /><p v-for="turn in app.review.package.source.turns" :key="turn.id"><strong>{{ turn.speaker }}：</strong>{{ turn.text }}</p></details>
            <ul><li v-for="chunk in app.review.package.chunks" :key="chunk.id">{{ chunk.title }}：{{ chunk.expression }} · {{ chunk.meaning }}</li></ul>
            <ol><li v-for="level in app.review.package.levels" :key="level.id">{{ level.title }}：{{ [...level.newGoalIds, ...level.reviewGoalIds].map(id => app.review!.package.goals.find(goal => goal.id === id)?.title).join('、') }}</li></ol>
            <button :disabled="app.busy || app.processingAudio || editingReview" @click="app.error = ''; app.editingOutline = true">修改知识块与关卡</button>
            <OutlineEditor v-if="app.editingOutline" ref="outlineEditor" :key="app.review.package.revision" :package="app.review.package" :busy="app.busy" :error="app.error" @save="app.saveOutline" @cancel="app.editingOutline = false; workspace.notify('已取消修改，原安排保留。')" />
            <label class="passage-check"><input v-model="app.review.sourceConfirmed" type="checkbox" :disabled="app.busy || app.generating || reviewedPublication || editingReview" />我已核对全部原文、知识块与关卡安排</label>
            <p>审核进度 {{ app.review.reviewedQuestionIds.length }} / {{ app.review.package.questions.length }}。请逐题确认语境、选项、答案和说明，预览一轮不能代替审核整个题库。</p>
            <p v-if="app.reviewDirty" class="passage-note" role="status">有未保存的审核修改。点击“保存审核草稿”或离开页面时会保存。</p>
            <p v-if="reviewedPublication" class="passage-note">本修订已发布。修改会建立独立候选修订，孩子当前可学版本保持可用。</p>
            <p v-if="publicationComparison" class="passage-note">相对孩子当前版本：新增 {{ publicationComparison.added }} 道、修改 {{ publicationComparison.changed }} 道、移除 {{ publicationComparison.removed }} 道题<span v-if="publicationComparison.outline">，调整了知识块或关卡</span>；{{ app.review.package.questions.length - app.review.reviewedQuestionIds.length }} 道待审核，{{ app.review.reviewedQuestionIds.length }} 道已审核。发布后已有学习记录仍会保留，新版本还需确认音频就绪。</p>
            <div class="passage-review-groups"><label>审核关卡<select v-model="app.reviewLevel" :disabled="editingReview" @change="app.groupReview"><option value="all">全部关卡</option><option v-for="level in app.review.package.levels" :key="level.id" :value="level.id">{{ level.title }}</option></select></label><label>审核目标<select v-model="app.reviewGoal" :disabled="editingReview" @change="app.groupReview"><option value="all">全部目标</option><option v-for="goal in reviewGoals" :key="goal.id" :value="goal.id">{{ goal.title }}</option></select></label></div>
            <label v-if="hasCurriculum(app.review.package)">审核短课<select v-model="app.reviewLesson" :disabled="editingReview" @change="app.groupReview"><option value="all">全部短课</option><option value="discover">初识表达</option><option value="transfer">换情境用</option><option value="communicate">听说应答</option></select></label>
            <p class="field-help">当前分组：{{ groupApproved }} / {{ app.reviewGroupQuestions.length }} 道已审核。</p>
            <div class="passage-actions" aria-label="题目审核筛选"><button v-for="filter in (['all', 'pending', 'returned'] as const)" :key="filter" :disabled="editingReview" :aria-pressed="app.reviewFilter === filter" @click="app.filterReview(filter)">{{ ({all:'全部题目',pending:'待审核',returned:'待修改'})[filter] }}</button></div>
            <label>查看候选题<select v-model="app.reviewIndex" :disabled="app.busy || app.generating || editingReview"><option v-if="reviewPosition < 0 && currentInGroup && app.reviewFilter === 'pending' && app.reviewQuestion" :value="app.reviewIndex" disabled>本题已审核 · {{ app.reviewQuestion.prompt }}</option><option v-for="{question, index} in app.reviewQuestions" :key="question.id" :value="index">{{ index + 1 }}. {{ app.review.reviewedQuestionIds.includes(question.id) ? '已审核' : app.review.returnedQuestionIds?.includes(question.id) ? '待修改' : '待审核' }} · {{ question.prompt }}</option></select></label>
            <QuestionEditor v-if="app.editingQuestion && app.reviewQuestion" ref="questionEditor" :key="app.review.package.revision + app.reviewQuestion.id" :question="app.reviewQuestion" :source="app.review.package.source" :busy="app.busy" :error="app.error" @save="saveQuestion" @cancel="app.editingQuestion = false; workspace.notify('已取消修改，原题保留。')" />
            <article v-else-if="!app.editingOutline && app.reviewQuestion && (app.reviewQuestions.length || app.reviewFilter === 'pending' && currentInGroup)" class="passage-review-question">
              <p v-if="!app.reviewQuestions.length && app.reviewFilter === 'pending'" class="passage-note">这一组已审核完成，可以切换目标或准备发布。</p>
              <h3>{{ app.reviewQuestion.prompt }}</h3><p>题型：{{ ({ choice: '理解选择', 'listen-choice': '听音选择', 'dialogue-choice': '对话选择', order: '词块排序', cloze: '补全表达', speak: '口语应答' })[app.reviewQuestion.kind] }} · 目标：{{ app.review.package.goals.find(goal => goal.id === app.reviewQuestion?.goalId)?.title }}</p>
              <p v-if="app.reviewQuestion.context" class="passage-note">换个情境：{{ app.reviewQuestion.context.text }}。请核对新情境可理解、没有直接泄露答案，且沿用课文已学表达。</p>
              <ul v-if="app.reviewQuestion.kind === 'speak'"><li v-for="criterion in app.reviewQuestion.criteria" :key="criterion">回听要点：{{ criterion }}</li></ul>
              <p v-for="id in app.reviewQuestion.sourceTurnIds" :key="id">原文依据：{{ app.review.package.source.turns.find(turn => turn.id === id)?.text }}</p>
              <ul v-if="'options' in app.reviewQuestion"><li v-for="option in app.reviewQuestion.options" :key="option.id">{{ option.text }}</li></ul>
              <p v-if="app.reviewQuestion.kind === 'order'">词块：{{ app.reviewQuestion.tokens.map(token => token.text).join(' / ') }}</p>
              <p v-if="app.reviewQuestion.audioText">音频内容：{{ app.reviewQuestion.audioText }}</p>
              <p>答案：{{ answer(app.reviewQuestion) }}</p><p>说明：{{ app.reviewQuestion.explanation }}</p>
              <p v-if="app.review.returnedQuestionIds?.includes(app.reviewQuestion.id)" class="passage-note">本题已退回，请修改后重新审核。</p>
              <label class="passage-check"><input type="checkbox" :checked="app.review.reviewedQuestionIds.includes(app.reviewQuestion.id)" :disabled="app.busy || app.generating || reviewedPublication" @change="app.toggleReviewed(($event.target as HTMLInputElement).checked)" />本题语境、答案和说明已审核</label>
              <div class="passage-actions"><button :disabled="app.busy" @click="previewOpen = true">以孩子视角试答</button><button :disabled="app.busy || app.generating || app.processingAudio" @click="app.error = ''; app.editingQuestion = true">修改本题</button><button :disabled="app.busy || app.generating || reviewedPublication" @click="app.returnQuestion">退回修改</button><button class="primary" :disabled="app.busy || app.generating || reviewedPublication" @click="app.approveAndNext">审核通过，下一题</button></div>
            </article>
            <p v-else-if="!editingReview">此筛选下没有题目，可以切换筛选或继续准备发布。</p>
            <div class="passage-actions"><button :disabled="editingReview || reviewPosition <= 0" @click="moveReview(-1)">上一题</button><button :disabled="editingReview || !app.reviewQuestions.length || reviewPosition + 1 >= app.reviewQuestions.length" @click="moveReview(1)">下一题</button><button :disabled="app.busy || app.generating || editingReview" @click="app.saveReviewDraft">保存审核草稿</button></div>
          </section>
          <CourseAudioPanel v-if="!editingReview" :speech="app.candidateAudio" :authorize="authorize" @settings="navigate('settings')" />
          <section class="passage-card"><h2>发布学习内容</h2><p>全部候选题审核通过、完整音频就绪后可以发布。孩子当前使用的学习模式由统一设置决定。</p><p>当前开放模式：{{ app.mode.modes.find(mode => mode.id === app.mode.activeModeId)?.title }}</p><p v-if="reviewedPublication" class="passage-note">本修订已发布，课程和历史作答保留。</p><button class="primary" :disabled="app.busy || app.generating || editingReview || reviewedPublication || !reviewComplete || !app.candidateAudio.courseAudio.complete" @click="authorize('启用新版本', app.publish)">{{ reviewedPublication ? '本修订已发布' : '审核并启用本版本' }}</button><button @click="workspace.openSettings">前往模式设置</button></section>
        </template>
      </section>
      <QuestionPreview v-if="previewOpen && app.reviewQuestion && app.review" :question="app.reviewQuestion" :audio-ready="app.candidateAudio.courseAudio.complete" :busy="app.busy || app.candidateAudio.phase !== 'idle'" @close="closePreview" @play="playPreview" />
        <section v-if="app.view === 'report' && app.report" class="passage-card"><h2>当前孩子的学习情况</h2><p>{{ app.learner?.nickname }} · {{ app.course?.title }}</p><p>路径 {{ app.report.completedLevels }} / {{ app.report.totalLevels }} · 首次答对 {{ app.report.firstCorrectCount }} / {{ app.report.firstAttemptCount }}</p><p>主动查看辅助 {{ app.report.helpRequestCount }} 项（同一题的提示、原文、示范各计一项，整课原文另计一项）<span v-if="!app.report.helpTrackingComplete">（旧版练习未单独记录，此处不包含旧版操作）</span></p><p v-if="app.pkg && hasCurriculum(app.pkg)">短课 {{ app.report.completedShortLessons }} / {{ app.report.totalShortLessons }} · 完成录音回听 {{ app.report.oralPracticeCount }} 次。</p><p>接触答案后的巩固作答 {{ app.report.assistedAttemptCount }} 次 · 补练 {{ app.report.repairAttemptCount }} 次。</p><p>提交后看到参考答案，同目标的后续作答会计入巩固；这不表示孩子主动查看了同样次数的提示。路径完成和知识稳定分别记录。</p></section>
      <section v-if="app.view === 'report' && !app.report" class="passage-card"><h1>课文闯关学习报告</h1><p>当前课程还没有可展示的学习数据。</p></section>
      <section v-if="app.view === 'report' && oralHistory.length" class="passage-card"><h2>口语练习回听</h2><p>共 {{ oralHistory.length }} 次。录音与自评记录完成情况，发音和表达尚未自动判分。</p>
        <ul><li v-for="attempt in oralHistory.slice(0, recentOralCount)" :key="attempt.id">{{ new Date(attempt.at).toLocaleString() }} · {{ attempt.response.oral?.selfRating === 'ready' ? '我能说清楚' : '还想再练' }} <button :disabled="app.busy" @click="app.hearRecording(attempt.response.oral!.recordingPath)">回听这次练习</button></li></ul>
        <button v-if="recentOralCount < oralHistory.length" @click="recentOralCount += 10">查看更多口语练习</button>
      </section>
    </div>
  </div>
</template>
