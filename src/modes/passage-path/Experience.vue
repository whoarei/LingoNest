<script setup lang="ts">
import "./style.css";
import { computed, nextTick, onMounted, onScopeDispose, reactive, ref } from "vue";
import { useExperience, type PassageView } from "./useExperience";
import type { PassageQuestion } from "../../../packages/learning-modes/passage-path/model";
import { isAndroid, native } from "../../native";
import ParentModeSettings from "../../components/ParentModeSettings.vue";
import ContentSettings from "../../components/ContentSettings.vue";
import SpeechSettings from "../../components/SpeechSettings.vue";
import CourseAudioPanel from "../../components/CourseAudioPanel.vue";
import SourceImages from "../../components/SourceImages.vue";
import CourseModeNotice from "../../components/CourseModeNotice.vue";
const app = reactive(useExperience());
const nickname = ref(""), parentAnswer = ref(""), pendingAction = ref<null | (() => Promise<void>)>(null);
const noFlexGap = ref(false), parentConfirmed = ref(false);
let disposed = false, backBusy = false;
let backListener: { remove(): Promise<void> } | undefined;
async function authorize(_label: string, action: () => Promise<void>) {
  parentAnswer.value = ""; pendingAction.value = action;
  await nextTick(); document.querySelector<HTMLInputElement>(".passage-confirm input")?.focus();
}
async function confirmParent() {
  if (parentAnswer.value.trim() !== "12" || !pendingAction.value) return;
  const action = pendingAction.value; pendingAction.value = null; parentConfirmed.value = true;
  await action();
}
async function enterParent() { await authorize("进入家长空间", () => app.openManager(app.courseId)); }
async function navigate(view: PassageView) {
  if (view === "parent" && !parentConfirmed.value) { await enterParent(); return; }
  await app.navigate(view);
}
const original = computed(() => app.view === "practice" ? app.questionPackage : app.pkg);
const orderedOptions = computed(() => {
  const question = app.question;
  if (!question || question.kind === "cloze" || question.kind === "order") return [];
  return app.item!.displayIds.map(id => question.options.find(option => option.id === id)!);
});
const orderedTokens = computed(() => {
  const question = app.question;
  return question?.kind === "order" ? app.item!.displayIds.map(id => question.tokens.find(token => token.id === id)!) : [];
});
const selectedTokens = computed(() => app.response.selectedIds.map(id => orderedTokens.value.find(token => token.id === id)!).filter(Boolean));
function choose(id: string) { app.response.selectedIds = [id]; app.inputChanged(); }
function toggleToken(id: string) {
  app.response.selectedIds = app.response.selectedIds.includes(id) ? app.response.selectedIds.filter(item => item !== id) : [...app.response.selectedIds, id];
  app.inputChanged();
}
function answer(question: PassageQuestion) {
  if (question.kind === "cloze") return question.answers.join(" / ");
  if (question.kind === "order") return question.correctTokenIds.map(id => question.tokens.find(token => token.id === id)!.text).join(" ");
  return question.options.find(option => option.id === question.correctOptionId)!.text;
}
const canSubmit = computed(() => app.question?.kind === "cloze" ? !!app.response.text.trim() : app.response.selectedIds.length > 0);
const completedLevelIds = computed(() => app.data.completions.filter(item => item.learnerId === app.learner?.id && item.courseId === app.courseId && item.revision === app.pkg?.revision).map(item => item.levelId));
const reviewComplete = computed(() => app.review && app.review.sourceConfirmed && app.review.package.questions.every(question => app.review!.reviewedQuestionIds.includes(question.id)));
async function handleBack() {
  if (backBusy || app.busy || app.mode.busy) return;
  backBusy = true;
  try {
    const closeImage = document.querySelector<HTMLButtonElement>(".passage-path-mode .image-backdrop .image-close");
    if (closeImage) { closeImage.click(); return; }
    if (pendingAction.value) { pendingAction.value = null; return; }
    if (app.originalOpen) { app.originalOpen = false; return; }
    if (app.view === "settings") await app.navigate(app.settingsOrigin);
    else if (app.view !== "home") await app.navigate("home");
    else if (isAndroid) { await app.prepareLeave(); await native.exitApp(); }
  } catch (failure) { app.error = failure instanceof Error ? failure.message : String(failure); }
  finally { backBusy = false; }
}
onMounted(() => {
  const probe = document.createElement("div");
  probe.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;top:-9999px";
  probe.append(document.createElement("div"), document.createElement("div")); document.body.appendChild(probe);
  noFlexGap.value = probe.scrollHeight !== 1; probe.remove();
  if (isAndroid) void native.addListener("backButton", () => { void handleBack(); }).then(handle => {
    if (disposed) void handle.remove(); else backListener = handle;
  }).catch(() => {});
});
onScopeDispose(() => { disposed = true; void backListener?.remove(); });
</script>
<template>
  <div class="passage-path-mode" :class="{ 'no-flex-gap': noFlexGap }" :aria-busy="app.busy || app.mode.busy">
    <header class="passage-header">
      <div><span class="passage-brand">LingoNest · 课文闯关</span><p>从课文出发，把表达用起来</p></div>
      <div class="passage-actions">
        <button :disabled="app.busy || app.generating || app.processingAudio || !!pendingAction" aria-label="设置" @click="navigate('settings')">设置</button>
        <button v-if="app.view !== 'parent'" :disabled="app.busy || app.generating || app.processingAudio || !!pendingAction" @click="enterParent">家长空间</button>
        <button v-else :disabled="app.busy || app.generating || app.processingAudio || !!pendingAction" @click="navigate('home')">返回学习空间</button>
      </div>
    </header>
    <p v-if="app.error" role="alert" class="passage-error">{{ app.error }}</p>
    <p v-if="app.message" role="status" class="passage-note">{{ app.message }}</p>
    <form v-if="pendingAction" class="passage-card passage-confirm" role="dialog" aria-modal="true" aria-labelledby="passage-confirm-title" @submit.prevent="confirmParent">
      <h2 id="passage-confirm-title">请家长确认</h2><p>7 + 5 = ?（用于防止误触）</p>
      <label>7加5的答案<input v-model="parentAnswer" inputmode="numeric" autocomplete="off" /></label>
      <div class="passage-actions"><button class="primary" :disabled="parentAnswer.trim() !== '12'">确认并继续</button><button type="button" @click="pendingAction = null">取消操作</button></div>
    </form>
    <main v-if="!app.ready" class="passage-card"><p>正在读取课程与学习记录…</p><button v-if="app.error" @click="app.boot">重新读取</button></main>
    <fieldset v-else :disabled="!!pendingAction" class="passage-screen">
      <section v-if="!app.learner" class="passage-card">
        <h1>建立学习档案</h1><label>孩子昵称<input v-model="nickname" maxlength="16" /></label>
        <button class="primary" :disabled="app.busy || !nickname.trim()" @click="authorize('建立档案', () => app.addLearner(nickname))">建立档案</button>
      </section>
      <nav v-if="app.view !== 'settings' && app.view !== 'parent'" class="passage-tabs" aria-label="闯关导航">
        <button :aria-current="app.view === 'home' ? 'page' : undefined" :disabled="app.busy" @click="navigate('home')">学习路径</button>
        <button :disabled="app.busy || !app.pkg" @click="app.view === 'practice' ? app.reveal('source') : navigate('source')">课文原文</button>
      </nav>
      <section v-if="app.view === 'home'" class="passage-stack">
        <div class="passage-card passage-context">
          <label>当前孩子<select :value="app.learner?.id" :disabled="app.busy" @change="app.selectLearner(($event.target as HTMLSelectElement).value)"><option v-for="learner in app.directory.learners" :key="learner.id" :value="learner.id">{{ learner.nickname }}</option></select></label>
          <label>学习课程<select :value="app.courseId" :disabled="app.busy || !app.learner" @change="app.selectCourse(($event.target as HTMLSelectElement).value)"><option v-for="course in app.directory.courses.filter(item => !item.archivedAt)" :key="course.id" :value="course.id">{{ course.title }}</option></select></label>
        </div>
        <CourseModeNotice v-if="!app.pkg" :title="app.course?.title ?? '当前课程'" mode-title="课文闯关" :status="app.data.candidates?.some(item => item.package.courseId === app.courseId) ? 'review' : 'missing'" @prepare="enterParent" />
        <template v-else>
          <section class="passage-card passage-hero">
            <p class="eyebrow">今天，往前走一小步</p><h1>{{ app.course?.title }}</h1>
            <p>每轮约 3–5 分钟，新表达和复习一起练。随时可以查看原文。</p>
            <p v-if="!app.audioAvailable" class="passage-note">本课音频尚未就绪，请家长在课程管理中修复后再学习。</p>
            <button class="primary" :disabled="app.busy || !app.learner || !app.audioAvailable" @click="app.start()">{{ app.activeRun ? '继续学习' : '开始学习' }}</button>
            <button v-if="!app.audioAvailable" @click="enterParent">请家长修复音频</button>
          </section>
          <ol class="passage-levels" aria-label="课程路径">
            <li v-for="(level, index) in app.pkg.levels" :key="level.id" class="passage-card">
              <span class="level-number">{{ completedLevelIds.includes(level.id) ? '✓' : index + 1 }}</span>
              <div><h2>{{ level.title }}</h2><p>{{ completedLevelIds.includes(level.id) ? '路径已完成' : index === completedLevelIds.length ? '下一小步' : '前面关卡完成后开放' }}</p></div>
              <button v-if="completedLevelIds.includes(level.id)" :disabled="app.busy || !app.audioAvailable" @click="app.start(level.id)">重练</button>
            </li>
          </ol>
          <section v-if="app.report" class="passage-card">
            <h2>学习足迹</h2><p>路径 {{ app.report.completedLevels }} / {{ app.report.totalLevels }} · 首次作答 {{ app.report.firstAttemptCount }} 次</p>
            <p>路径完成表示练过；稳定表现需要在不同日期独立用对。</p>
            <ul><li v-for="goal in app.report.goals" :key="goal.goalId">{{ app.pkg.goals.find(item => item.id === goal.goalId)?.title }} · {{ ({ unseen: '还没练到', practicing: '练习中', weak: '需要巩固', stable: '表现稳定' })[goal.status] }}</li></ul>
          </section>
        </template>
      </section>
      <section v-if="app.view === 'practice'" class="passage-stack">
        <template v-if="app.session?.status === 'active' && app.question">
          <section class="passage-card passage-practice">
            <div class="passage-actions"><span>第 {{ app.session.index + 1 }} / {{ app.session.queue.length }} 题</span><button :disabled="app.busy" @click="navigate('home')">保存并退出</button></div>
            <p v-if="app.item?.courseId !== app.courseId" class="eyebrow">穿插复习 · {{ app.questionPackage?.source.title }}</p>
            <p v-if="app.item?.reason === 'repair'" class="eyebrow">再试一次 · 这一轮的补练</p>
            <h1>{{ app.question.prompt }}</h1>
            <button v-if="app.question.audioText" :disabled="app.busy" @click="app.play(app.question!.audioText!)">播放题目音频</button>
            <fieldset :disabled="app.busy || !!app.feedback" class="passage-answer">
              <legend class="sr-only">你的答案</legend>
              <label v-if="app.question.kind === 'cloze'">填写答案<input v-model="app.response.text" autocapitalize="none" autocomplete="off" :spellcheck="false" @input="app.inputChanged" /></label>
              <template v-else-if="app.question.kind === 'order'">
                <div class="passage-selected" aria-label="已选词块">{{ selectedTokens.map(token => token.text).join(' ') || '按顺序点选词块' }}</div>
                <div class="passage-tokens"><button v-for="token in orderedTokens" :key="token.id" :aria-pressed="app.response.selectedIds.includes(token.id)" @click="toggleToken(token.id)">{{ token.text }}</button></div>
              </template>
              <div v-else class="passage-choices"><button v-for="option in orderedOptions" :key="option.id" :aria-pressed="app.response.selectedIds.includes(option.id)" @click="choose(option.id)">{{ option.text }}</button></div>
            </fieldset>
            <div v-if="!app.feedback" class="passage-actions"><button class="primary" :disabled="app.busy || !canSubmit" @click="app.submit">检查答案</button><button :disabled="app.busy" @click="app.reveal('hint')">看提示</button><button :disabled="app.busy" @click="app.reveal('source')">查看原文</button></div>
            <p v-if="app.hintOpen && !app.feedback" class="passage-note">{{ app.questionPackage?.chunks.find(chunk => chunk.id === app.questionPackage?.goals.find(goal => goal.id === app.question?.goalId)?.chunkId)?.meaning }} · 本次使用了辅助。</p>
            <div v-if="app.feedback" class="passage-feedback" role="status"><h2>{{ app.feedback.correct ? '答对了' : '一起看一看' }}</h2><p>参考答案：{{ answer(app.question) }}</p><p>{{ app.question.explanation }}</p><button class="primary" :disabled="app.busy" @click="app.next">继续</button></div>
          </section>
        </template>
        <section v-else class="passage-card"><h1>{{ app.session?.status === 'completed' ? '这一轮完成了' : '请重新进入学习' }}</h1><p>已保存的学习事实会保留，路径完成和稳定表现分别记录。</p><button class="primary" @click="navigate('home')">返回学习路径</button></section>
      </section>
      <section v-if="app.view === 'source' || app.originalOpen" class="passage-card passage-original">
        <div class="passage-actions"><h2>{{ original?.source.title }} · 原文</h2><button v-if="app.originalOpen" @click="app.originalOpen = false">收起原文</button></div>
        <template v-if="original"><SourceImages :images="original.source.images ?? []" /><div v-for="turn in original.source.turns" :key="turn.id" class="passage-turn"><p><strong v-if="turn.speaker">{{ turn.speaker }}:</strong> {{ turn.text }}</p><button :disabled="app.busy" :aria-label="`朗读原文 ${turn.id}`" @click="app.play(turn.text, original)">听原文</button></div></template>
      </section>
      <section v-show="app.view === 'parent'" class="passage-stack passage-parent" aria-label="课文闯关家长空间">
        <div class="passage-card"><h1>家长空间 · 课文闯关</h1><p>教材和孩子档案由所有课程模式共用；本页审核闯关模式的题库。</p>
          <label>管理课程<select :value="app.managedId" :disabled="app.busy || app.generating" @change="app.openManager(($event.target as HTMLSelectElement).value)"><option v-for="course in app.directory.courses.filter(item => !item.archivedAt)" :key="course.id" :value="course.id">{{ course.title }}</option></select></label>
          <button :disabled="app.busy || app.generating" @click="app.openManager('')">新建教材</button>
          <p v-if="app.publishedManaged">本课已有开放版本。重新生成的候选不会影响它；采用新版本后，新路径从第一关记录，历史作答保留。</p>
        </div>
        <form class="passage-card" @submit.prevent="app.saveMaterial">
          <h2>教材原文</h2><fieldset :disabled="app.busy || app.generating || !!app.publishedManaged || !!app.managed?.builtin || app.managed?.sourceEditable === false">
            <label>课程标题<input v-model="app.material.title" maxlength="100" required @input="app.materialChanged" /></label>
            <label>课程说明<input v-model="app.material.subtitle" maxlength="120" @input="app.materialChanged" /></label>
            <label>已确认课文<textarea v-model="app.material.sourceText" rows="8" maxlength="6000" required @input="app.materialChanged"></textarea></label>
            <button class="primary">保存教材</button>
          </fieldset><SourceImages :images="[...app.material.images, ...app.material.supplementImages]" />
          <p>按行保留课文话轮，可写“角色: 原文”。生成会将已确认课文发送至设置中的课程模型。</p>
        </form>
        <section v-if="app.managed" class="passage-card"><h2>生成候选题库</h2><p>围绕课文中的交流用途编排短关卡。模型生成后还需要完整审核。</p>
          <button v-if="!app.generating" class="primary" :disabled="app.busy || app.candidateAudio.courseGenerating" @click="app.generate">{{ app.review ? '重新生成候选题库' : '生成闯关题库' }}</button>
          <button v-else @click="app.cancelGeneration">暂停课程生成</button>
        </section>
        <template v-if="app.review">
          <section class="passage-card"><h2>审核整个候选题库</h2><p>{{ app.review.package.levels.length }} 关 · {{ app.review.package.questions.length }} 道候选题（实际练习按规则选题）</p>
            <ul><li v-for="chunk in app.review.package.chunks" :key="chunk.id">{{ chunk.title }}：{{ chunk.expression }} · {{ chunk.meaning }}</li></ul>
            <ol><li v-for="level in app.review.package.levels" :key="level.id">{{ level.title }}</li></ol>
            <label class="passage-check"><input v-model="app.review.sourceConfirmed" type="checkbox" :disabled="app.busy || app.generating" />我已核对全部原文、知识块与关卡安排</label>
            <p>审核进度 {{ app.review.reviewedQuestionIds.length }} / {{ app.review.package.questions.length }}。请逐题确认语境、选项、答案和说明，预览一轮不能代替审核整个题库。</p>
            <label>查看候选题<select v-model="app.reviewIndex" :disabled="app.busy || app.generating"><option v-for="(question, index) in app.review.package.questions" :key="question.id" :value="index">{{ index + 1 }}. {{ question.prompt }}</option></select></label>
            <article v-if="app.reviewQuestion" class="passage-review-question">
              <h3>{{ app.reviewQuestion.prompt }}</h3><p>题型：{{ ({ choice: '理解选择', 'listen-choice': '听音选择', 'dialogue-choice': '对话选择', order: '词块排序', cloze: '补全表达' })[app.reviewQuestion.kind] }} · 目标：{{ app.review.package.goals.find(goal => goal.id === app.reviewQuestion?.goalId)?.title }}</p>
              <p v-for="id in app.reviewQuestion.sourceTurnIds" :key="id">原文依据：{{ app.review.package.source.turns.find(turn => turn.id === id)?.text }}</p>
              <ul v-if="'options' in app.reviewQuestion"><li v-for="option in app.reviewQuestion.options" :key="option.id">{{ option.text }}</li></ul>
              <p v-if="app.reviewQuestion.kind === 'order'">词块：{{ app.reviewQuestion.tokens.map(token => token.text).join(' / ') }}</p>
              <p v-if="app.reviewQuestion.audioText">音频内容：{{ app.reviewQuestion.audioText }}</p>
              <p>答案：{{ answer(app.reviewQuestion) }}</p><p>说明：{{ app.reviewQuestion.explanation }}</p>
              <label class="passage-check"><input type="checkbox" :checked="app.review.reviewedQuestionIds.includes(app.reviewQuestion.id)" :disabled="app.busy || app.generating" @change="app.toggleReviewed(($event.target as HTMLInputElement).checked)" />本题语境、答案和说明已审核</label>
            </article>
            <div class="passage-actions"><button :disabled="app.reviewIndex === 0" @click="app.reviewIndex--">上一题</button><button :disabled="app.reviewIndex + 1 >= app.review.package.questions.length" @click="app.reviewIndex++">下一题</button><button :disabled="app.busy || app.generating" @click="app.saveReviewDraft">保存审核草稿</button></div>
          </section>
          <CourseAudioPanel :speech="app.candidateAudio" :authorize="authorize" @settings="navigate('settings')" />
          <section class="passage-card"><h2>开放给孩子</h2><p>只有全部候选题审核通过、完整音频就绪后才能开放。</p><button class="primary" :disabled="app.busy || app.generating || !reviewComplete || !app.candidateAudio.courseAudio.complete" @click="authorize('启用新版本', app.publish)">审核并启用本版本</button></section>
        </template>
        <section v-if="app.report" class="passage-card"><h2>当前孩子的学习情况</h2><p>{{ app.learner?.nickname }} · {{ app.course?.title }}</p><p>路径 {{ app.report.completedLevels }} / {{ app.report.totalLevels }} · 首次答对 {{ app.report.firstCorrectCount }} / {{ app.report.firstAttemptCount }}</p><p>使用辅助 {{ app.report.assistedAttemptCount }} 次 · 补练 {{ app.report.repairAttemptCount }} 次。路径完成和知识稳定分别记录。</p></section>
        <section class="passage-card"><h2>孩子档案</h2><form class="passage-actions" @submit.prevent="authorize('建立档案', () => app.addLearner(nickname))"><label>新增孩子昵称<input v-model="nickname" maxlength="16" required /></label><button :disabled="app.busy">新增孩子</button></form></section>
      </section>
      <section v-if="app.view === 'settings'" class="passage-stack settings-page">
        <div class="passage-card"><h1>小窝设置</h1><button :disabled="app.busy || app.mode.busy" @click="navigate(app.settingsOrigin)">返回{{ app.settingsOrigin === 'parent' ? '家长空间' : '学习空间' }}</button></div>
        <ParentModeSettings /><ContentSettings /><SpeechSettings :speech="app.baseSpeech" />
      </section>
    </fieldset>
  </div>
</template>
