import { computed, effectScope, inject, onScopeDispose, reactive, ref, watch } from "vue";
import type { CatalogSnapshot, MaterialInput } from "../../../packages/learning-modes/catalog";
import type { PassageLesson, PassagePackage, PassageResponse, PassageReview } from "../../../packages/learning-modes/passage-path/model";
import { emptyPassageState } from "../../../packages/learning-modes/passage-path/state";
import { compilePassagePackage, makePassageAudioManifest } from "../../../packages/learning-modes/passage-path/authoring";
import { latestReviewForSource, reviseQuestion, reviseOutline, type PassageOutline } from "../../../packages/learning-modes/passage-path/review";
import type { PassageQuestion } from "../../../packages/learning-modes/passage-path/model";
import { generatePassageCandidate } from "../../../packages/learning-modes/passage-path/prompts";
import { passageReport } from "../../../packages/learning-modes/passage-path/reporting";
import { questionFor, packageFor } from "../../../packages/learning-modes/passage-path/references";
import { copy } from "../../../packages/learning-modes/passage-path/validation";
import { passageServicesKey } from "./services";
import { currentMaterialReviews, passageSourceFromMaterial } from "./material";
import { catalogKey } from "../../platform/catalog";
import { useModeSelection } from "../../platform/mode-selection";
import { createContentRequests } from "../../platform/content-requests";
import { contentNative } from "../../platform/content";
import { useSpeech } from "../../platform/speech";
import { useWorkspace } from "../../application/workspace";
import { learningAudioPackages } from "./learning-audio";
import { isAndroid, native } from "../../native";
import { roundSummary, reviewSuggestion } from "../../../packages/learning-modes/passage-path/summary";
import { lessonQuestion } from "../../../packages/learning-modes/passage-path/curriculum";

export type PassageView = "home" | "practice" | "source" | "parent" | "settings" | "report";
const identity = (prefix: string) => `${prefix}.${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
export function useExperience() {
  const services = inject(passageServicesKey)!, catalog = inject(catalogKey)!;
  const workspace = useWorkspace();
  const mode = useModeSelection(), requests = createContentRequests();
  const ready = ref(false), busy = ref(false), generating = ref(false), playing = ref(false), error = ref(""), message = ref("");
  const view = ref<PassageView>("home"), settingsOrigin = ref<PassageView>("home");
  const data = ref(emptyPassageState()), directory = ref<CatalogSnapshot>({ learners: [], activeLearnerId: null, defaultCourseId: "", learningCourseIds: {}, courses: [] });
  const learner = computed(() => directory.value.learners.find(item => item.id === directory.value.activeLearnerId));
  const courseId = computed(() => workspace.surface.value === "report" && workspace.courseId.value ? workspace.courseId.value : directory.value.learningCourseIds[learner.value?.id ?? ""] ?? directory.value.defaultCourseId);
  const course = computed(() => directory.value.courses.find(item => item.id === courseId.value));
  const publication = computed(() => data.value.publications.find(item => item.courseId === courseId.value));
  const pkg = computed(() => data.value.packages.find(item => item.courseId === courseId.value && item.revision === publication.value?.revision));
  const candidateAvailable = computed(() => currentMaterialReviews(data.value.candidates ?? [], course.value ? [course.value] : []).length > 0);
  const baseSpeech = useSpeech({ courseId: "passage-settings", courseVersion: "1", title: "课文闯关", assets: [] });
  const pendingAudio = ref(0);
  const processingAudio = computed(() => pendingAudio.value > 0);
  const pool = new Map<string, { scope: ReturnType<typeof effectScope>; speech: ReturnType<typeof useSpeech> }>();
  const audioKey = (pack: PassagePackage) => JSON.stringify([pack.courseId, pack.revision]);
  function audioFor(pack: PassagePackage) {
    const key = audioKey(pack);
    if (!pool.has(key)) {
      const scope = effectScope(true);
      const speech = scope.run(() => useSpeech(makePassageAudioManifest(pack), baseSpeech.configuration))!;
      const generate = speech.generateCourse;
      speech.generateCourse = async () => {
        pendingAudio.value++;
        try { return await generate(); }
        finally { pendingAudio.value--; }
      };
      pool.set(key, { scope, speech });
    }
    return pool.get(key)!.speech;
  }
  const lessonAudio = computed(() => pkg.value ? audioFor(pkg.value) : baseSpeech);
  const audioAvailable = computed(() => !!pkg.value && lessonAudio.value.courseReady.value && lessonAudio.value.courseAudio.value.complete);
  const sessionId = ref<string | null>(null);
  const session = computed(() => data.value.sessions.find(item => item.id === sessionId.value && item.learnerId === learner.value?.id && item.courseId === courseId.value && item.revision === pkg.value?.revision));
  const item = computed(() => session.value?.status === "active" ? session.value.queue[session.value.index] : undefined);
  const question = computed(() => item.value ? questionFor(data.value, item.value) : undefined);
  const questionPackage = computed(() => item.value ? packageFor(data.value, item.value.courseId, item.value.revision) : pkg.value);
  const feedback = computed(() => data.value.attempts.find(attempt => attempt.id === session.value?.feedbackAttemptId));
  const response = ref<PassageResponse>({ text: "", selectedIds: [] });
  const recording = ref(false), microphoneDenied = ref(false);
  let startingRecording: Promise<void> | undefined;
  let recordPlayback = false;
  const recordingScope = () => JSON.stringify([learner.value?.id, courseId.value, session.value?.id, session.value?.index,
    workspace.visible.value, workspace.surface.value, workspace.activation.value]);
  const summary = computed(() => session.value ? roundSummary(data.value, session.value) : null);
  const clock = ref(new Date().toISOString());
  const reviewDue = computed(() => pkg.value && learner.value ? reviewSuggestion(data.value, learner.value.id, pkg.value, clock.value) : null);
  const originalOpen = ref(false), hintOpen = ref(false);
  const report = computed(() => pkg.value && learner.value ? passageReport(data.value, learner.value.id, pkg.value.courseId, pkg.value.revision) : null);
  const activeRun = computed(() => data.value.sessions.some(item => item.status === "active" && item.learnerId === learner.value?.id && item.courseId === courseId.value));
  let disposed = false, jobEpoch = 0, playbackEpoch = 0;
  const current = () => !disposed && (mode.activeModeId.value === "passage-path" || workspace.surface.value === "report" || workspace.parent.value && workspace.surface.value === "authoring");
  const store = services.createStore(() => ({ activeModeId: current() && mode.activeModeId.value === "passage-path" && workspace.surface.value === "learning" ? "passage-path" : "unloaded",
    learnerId: learner.value?.id ?? "", courseId: courseId.value,
    courses: data.value.publications.map(publication => {
      const pack = data.value.packages.find(pack => pack.courseId === publication.courseId && pack.revision === publication.revision)!;
      return { courseId: pack.courseId, available: directory.value.courses.some(course => course.id === pack.courseId && !course.archivedAt),
        audioReady: pool.get(audioKey(pack))?.speech.courseAudio.value.complete === true && pool.get(audioKey(pack))?.speech.courseReady.value === true };
    }), clock: { at: new Date().toISOString(), trusted: true } }));
  const stopSubscription = services.state.subscribe(value => { if (current()) data.value = value; });
  watch(() => JSON.stringify([session.value?.id, session.value?.index, session.value?.feedbackAttemptId]), () => {
    response.value = copy(session.value?.input ?? { text: "", selectedIds: [] }); originalOpen.value = false; hintOpen.value = false;
  }, { flush: "sync" });

  const managedId = ref("");
  const managed = computed(() => directory.value.courses.find(item => item.id === managedId.value));
  const material = ref<MaterialInput>({ title: "", subtitle: "", sourceText: "", images: [], supplementImages: [] });
  let savedMaterial = "";
  const savedReview = ref("");
  const review = ref<PassageReview | null>(null), reviewIndex = ref(0);
  const reviewDirty = computed(() => !!review.value && savedReview.value !== JSON.stringify(review.value));
  const reviewQuestion = computed(() => review.value?.package.questions[reviewIndex.value]);
  const editingQuestion = ref(false);
  const editingOutline = ref(false);
  const reviewFilter = ref<"all" | "pending" | "returned">("all");
  const reviewLevel = ref("all"), reviewGoal = ref("all");
  const reviewLesson = ref<PassageLesson | "all">("all");
  const reviewGroupQuestions = computed(() => review.value?.package.questions.map((question, index) => ({ question, index })).filter(({ question }) => {
    if (reviewGoal.value !== "all" && question.goalId !== reviewGoal.value) return false;
    if (reviewLesson.value !== "all" && !lessonQuestion(question, reviewLesson.value)) return false;
    const level = review.value!.package.levels.find(level => level.id === reviewLevel.value);
    if (level && ![...level.newGoalIds, ...level.reviewGoalIds].includes(question.goalId)) return false;
    return true;
  }) ?? []);
  const reviewQuestions = computed(() => reviewGroupQuestions.value.filter(({ question }) => reviewFilter.value === "returned" ? review.value!.returnedQuestionIds?.includes(question.id) : reviewFilter.value === "all" || !review.value!.reviewedQuestionIds.includes(question.id)));
  const candidateAudio = computed(() => review.value ? audioFor(review.value.package) : baseSpeech);
  const publishedManaged = computed(() => data.value.publications.find(item => item.courseId === managedId.value));
  function bindManager(id: string) {
    managedId.value = id;
    const found = directory.value.courses.find(item => item.id === id);
    material.value = found ? copy({ title: found.title, subtitle: found.subtitle, sourceText: found.sourceText, images: found.images, supplementImages: found.supplementImages }) :
      { title: "", subtitle: "", sourceText: "", images: [], supplementImages: [] };
    savedMaterial = JSON.stringify(material.value);
    const candidates = data.value.candidates?.filter(item => item.package.courseId === id) ?? [];
    review.value = null;
    if (found && candidates.length) {
      try { review.value = latestReviewForSource(candidates, passageSourceFromMaterial(found)); } catch { /* An incomplete edited source also invalidates the old bank. */ }
      if (!review.value) message.value = "教材已更新，旧候选题库不再适用。请按最新教材重新生成，旧记录保留。";
    }
    savedReview.value = JSON.stringify(review.value); editingQuestion.value = false; editingOutline.value = false;
    reviewLevel.value = "all"; reviewGoal.value = "all"; reviewLesson.value = "all";
    reviewFilter.value = review.value && review.value.reviewedQuestionIds.length < review.value.package.questions.length ? "pending" : "all";
    reviewIndex.value = Math.max(0, review.value?.package.questions.findIndex(question => !review.value!.reviewedQuestionIds.includes(question.id)) ?? 0);
  }
  async function refreshDirectory() { const value = await catalog.read(); if (current()) directory.value = value; }
  async function checkAudio() {
    for (const pack of learningAudioPackages(data.value, directory.value, courseId.value)) {
      if (!current()) return;
      await audioFor(pack).refreshCourse().catch(() => {});
    }
  }
  async function stopAudio() {
    playbackEpoch++; playing.value = false;
    const stopRecord = recordPlayback; recordPlayback = false;
    await Promise.all([baseSpeech.stop(), ...[...pool.values()].map(item => item.speech.stop()), ...(isAndroid && stopRecord ? [native.stopAudio()] : [])]);
  }
  async function stopPlayback() {
    try { await stopAudio(); }
    catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : String(failure); }
  }
  let savingInput: Promise<void> | undefined;
  async function flushInput() {
    while (current()) {
      const run = session.value;
      if (run?.status !== "active" || run.feedbackAttemptId || JSON.stringify(run.input) === JSON.stringify(response.value)) return;
      await store.dispatch({ type: "input", sessionId: run.id, index: run.index, response: copy(response.value) });
    }
  }
  function persistInput() {
    return savingInput ??= flushInput().finally(() => { savingInput = undefined; });
  }
  async function persistDraft() {
    while (current() && (savedMaterial !== JSON.stringify(material.value) || reviewDirty.value)) {
      if (savedMaterial !== JSON.stringify(material.value)) {
        const captured = copy(material.value);
        if (!managedId.value) managedId.value = await catalog.createMaterial(captured);
        else await catalog.updateMaterial(managedId.value, captured);
        savedMaterial = JSON.stringify(captured); await refreshDirectory();
      }
      if (review.value && reviewDirty.value) {
        const captured = copy(review.value);
        await services.saveReview(captured, current); savedReview.value = JSON.stringify(captured);
      }
    }
  }
  async function prepareLeave() {
    if (busy.value || generating.value || processingAudio.value) throw Error("请先完成或暂停当前生成任务。");
    if (!ready.value) { await stopAudio(); return; }
    if (recording.value) await finishRecording();
    await persistInput(); await persistDraft(); await stopAudio();
  }
  async function run(action: () => Promise<void>) {
    if (busy.value || mode.busy.value || !current()) return false;
    if (generating.value || processingAudio.value) { error.value = "请先完成或暂停当前生成任务。"; return false; }
    const recovering = !!error.value;
    busy.value = true; error.value = ""; message.value = "";
    try { await action(); if (current() && recovering && !message.value) message.value = "已恢复，可以继续练习。"; return current(); }
    catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : String(failure); return false; }
    finally { if (!disposed) busy.value = false; }
  }
  async function navigate(next: PassageView) {
    if (generating.value) { error.value = "请先暂停当前生成任务。"; return; }
    await run(async () => {
      await persistInput(); await persistDraft(); await stopAudio();
      if (next === "source") {
        const active = data.value.sessions.find(item => item.status === "active" && item.learnerId === learner.value?.id && item.courseId === courseId.value);
        if (active && pkg.value) await store.dispatch({ type: "assist", sessionId: active.id, index: active.index, kind: "source", source: { courseId: pkg.value.courseId, revision: pkg.value.revision } });
      }
      if (next === "settings") settingsOrigin.value = view.value;
      originalOpen.value = false; view.value = next;
      if (next === "parent" && !managedId.value) bindManager(courseId.value);
    });
  }
  async function selectLearner(id: string) {
    await run(async () => { await persistInput(); await persistDraft(); await stopAudio(); await catalog.selectLearner(id);
      sessionId.value = null; await refreshDirectory(); view.value = "home"; });
  }
  async function selectCourse(id: string) {
    await run(async () => { if (!learner.value) throw Error("请先建立孩子档案。");
      await persistInput(); await persistDraft(); await stopAudio(); await catalog.assignCourse(learner.value.id, id);
      sessionId.value = null; await refreshDirectory(); view.value = "home"; });
  }
  async function start(replayLevelId?: string, replayLesson?: PassageLesson) {
    await run(async () => {
      await persistInput(); await persistDraft(); await refreshDirectory(); await checkAudio();
      await store.dispatch({ type: "start", sessionId: identity("session"), seed: crypto.getRandomValues(new Uint32Array(1))[0]!, replayLevelId, replayLesson });
      if (!current()) return;
      sessionId.value = data.value.sessions.find(item => item.status === "active" && item.learnerId === learner.value?.id && item.courseId === courseId.value)!.id;
      response.value = copy(session.value!.input); view.value = "practice";
    });
  }
  async function submit() {
    await run(async () => {
      if (recording.value) throw Error("请先结束录音。");
      // Drain autosaves before submission so a keyboard/blur event cannot queue
      // a stale input transaction behind the submitted answer.
      await persistInput();
      const run = session.value;
      if (!run) throw Error("请重新进入学习。");
      if (run.feedbackAttemptId) return;
      await checkAudio();
      await store.dispatch({ type: "submit", sessionId: run.id, index: run.index, attemptId: identity("attempt"), response: copy(response.value) });
    });
  }
  async function next() { await run(async () => {
    const run = session.value; if (!run) throw Error("会话已变更。");
    await store.dispatch({ type: "next", sessionId: run.id, index: run.index });
    if (session.value?.status === "completed") message.value = "这一轮完成了！路径进度已保存。稳定表现需要隔天独立练习。";
  }); }
  function inputChanged() {
    const recovering = !!error.value;
    error.value = "";
    if (recovering) message.value = "";
    void persistInput().then(() => {
      if (current() && recovering && !error.value) message.value = "作答已保存，可以继续。";
    }).catch(failure => { if (current()) error.value = String(failure instanceof Error ? failure.message : failure); });
  }
  async function reveal(kind: "source" | "hint") { await run(async () => {
    const run = session.value;
    if (run?.status === "active") await store.dispatch({ type: "assist", sessionId: run.id, index: run.index, kind });
    if (kind === "source") originalOpen.value = true; else hintOpen.value = true;
  }); }
  async function play(text: string, pack: PassagePackage | undefined = questionPackage.value) { await run(async () => {
    if (recording.value) throw Error("请先结束录音。");
    if (!pack) throw Error("本课尚未开放音频。");
    if (question.value?.kind === "speak" && question.value.audioText === text && item.value?.courseId === pack.courseId && item.value.revision === pack.revision &&
      session.value?.status === "active" && !feedback.value)
      await store.dispatch({ type: "assist", sessionId: session.value.id, index: session.value.index, kind: "sample" });
    const token = ++playbackEpoch, scope = recordingScope(); playing.value = true;
    try {
      const played = await audioFor(pack).play(text);
      if (!played && token === playbackEpoch) throw Error("播放已停止。");
      if (played && token === playbackEpoch && current() && scope === recordingScope() && !feedback.value &&
        question.value?.kind === "listen-choice" && question.value.audioText === text && item.value?.courseId === pack.courseId && item.value.revision === pack.revision) {
        response.value = { ...response.value, audioPlayed: true }; await persistInput();
      }
    }
    finally { if (token === playbackEpoch) playing.value = false; }
  }); }
  async function finishRecording() {
    const scope = recordingScope(), owner = learner.value?.id;
    try {
      const result = await native.stopRecording();
      if (!current() || scope !== recordingScope()) {
        if (owner && result.path.startsWith(`recordings/${owner}/`) && /^recordings\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.m4a$/.test(result.path))
          await native.deleteCourseResources({ images: [], recordings: [result.path] });
        return;
      }
      response.value = { text: "", selectedIds: [], oral: { recordingPath: result.path } };
      await persistInput();
    } finally { recording.value = false; }
  }
  async function toggleRecording() { await run(async () => {
    if (!isAndroid) throw Error("录音请在 Android 应用中使用；已完成的文字练习会保留。");
    if (question.value?.kind !== "speak" || feedback.value || !learner.value) return;
    if (recording.value) { await finishRecording(); return; }
    await persistInput(); await stopAudio(); const scope = recordingScope();
    startingRecording = native.startRecording({ learnerId: learner.value.id });
    try {
      await startingRecording; microphoneDenied.value = false;
      if (!current() || scope !== recordingScope()) { await native.cancelRecording(); return; }
      recording.value = true;
    } catch (failure) { microphoneDenied.value = (failure as { code?: string }).code === "MICROPHONE_DENIED"; throw failure; }
    finally { startingRecording = undefined; }
  }); }
  async function hearRecording(path = response.value.oral?.recordingPath) { await run(async () => {
    if (!path || !isAndroid) throw Error("请在录音所在的 Android 设备回听。");
    if (recording.value) throw Error("请先结束录音。");
    if (!path.startsWith(`recordings/${learner.value?.id}/`)) throw Error("录音不属于当前孩子。");
    await stopAudio(); const token = ++playbackEpoch, scope = recordingScope(); playing.value = true; recordPlayback = true;
    try {
      await native.playRecording({ path });
      if (token === playbackEpoch && current() && scope === recordingScope() && response.value.oral?.recordingPath === path && !feedback.value) {
        response.value = { ...response.value, oral: { ...response.value.oral, listened: true } }; await persistInput();
      }
    } catch (failure) { if (token === playbackEpoch) throw failure; }
    finally { if (token === playbackEpoch) { playing.value = false; recordPlayback = false; } }
  }); }
  function rateSpeaking(selfRating: "ready" | "again") {
    if (recording.value || busy.value || !response.value.oral?.listened || feedback.value) return;
    response.value = { ...response.value, oral: { ...response.value.oral, selfRating } }; inputChanged();
  }
  async function openManager(id: string) { await run(async () => {
    await persistInput(); await persistDraft(); await stopAudio(); bindManager(id); view.value = "parent";
  }); }
  async function saveMaterial() { await run(async () => {
    await persistDraft();
    message.value = "教材已保存。";
  }); }
  async function saveReviewDraft() { await run(async () => { await persistDraft(); message.value = "审核草稿已保存。"; }); }
  async function generate() {
    if (busy.value || generating.value || processingAudio.value || !current()) return;
    error.value = ""; message.value = "";
    const token = ++jobEpoch, id = managedId.value;
    const valid = () => current() && token === jobEpoch && id === managedId.value;
    generating.value = true;
    try {
      await persistDraft(); await refreshDirectory(); if (!valid()) return;
      const source = passageSourceFromMaterial(managed.value!);
      const config = await contentNative.getConfig(); if (!valid()) return;
      const generated = await generatePassageCandidate(source, prompt => requests.request("generation", prompt));
      if (!valid()) return;
      const existing = [...data.value.packages, ...(data.value.candidates ?? []).map(item => item.package)].find(item => item.courseId === id);
      const candidate: PassageReview = { package: compilePassagePackage({ ...generated, modeInstanceId: existing?.modeInstanceId ?? identity("instance"),
        revision: identity("revision"), model: config.generation.model, generatedAt: new Date().toISOString() }), sourceConfirmed: false, reviewedQuestionIds: [] };
      await services.saveReview(candidate, valid); if (!valid()) return;
      review.value = candidate; savedReview.value = JSON.stringify(candidate); reviewIndex.value = 0;
      reviewLevel.value = "all"; reviewGoal.value = "all"; reviewLesson.value = "all"; reviewFilter.value = "pending";
      message.value = "候选题库已保存。请核对原文、全部题目与答案，再准备音频并启用。";
    } catch (failure) { if (valid()) error.value = failure instanceof Error ? failure.message : String(failure); }
    finally { if (valid()) generating.value = false; }
  }
  async function cancelGeneration() { jobEpoch++; generating.value = false; await requests.cancel(); }
  async function publish() { await run(async () => {
    await persistDraft(); const candidate = review.value;
    if (!candidate) throw Error("请先生成候选题库。");
    await services.publishCandidate(candidate.package.courseId, candidate.package.revision, async () => {
      await candidateAudio.value.refreshCourse(); return candidateAudio.value.courseReady.value && candidateAudio.value.courseAudio.value.complete;
    }, current);
    sessionId.value = null; reviewFilter.value = "all"; message.value = "本模式内容已发布。当前给孩子开放的模式由统一设置管理，历史学习记录保留。";
  }); }
  function toggleReviewed(checked: boolean) {
    if (!review.value || !reviewQuestion.value) return;
    const id = reviewQuestion.value.id;
    review.value.reviewedQuestionIds = review.value.reviewedQuestionIds.filter(item => item !== id);
    if (checked) review.value.reviewedQuestionIds.push(id);
    if (checked && review.value.returnedQuestionIds) review.value.returnedQuestionIds = review.value.returnedQuestionIds.filter(item => item !== id);
  }
  async function saveQuestion(question: PassageQuestion) { return run(async () => {
    if (!review.value) throw Error("请重新进入候选题库。");
    await persistDraft();
    const candidate = reviseQuestion(review.value, question, identity("revision"));
    await services.saveReview(candidate, current);
    review.value = candidate; savedReview.value = JSON.stringify(candidate); editingQuestion.value = false;
    message.value = "本题修改已保存，需重新审核。其他审核进度保留，请核对新修订的音频。";
  }); }
  async function returnQuestion() { await run(async () => {
    if (!review.value || !reviewQuestion.value) return;
    const id = reviewQuestion.value.id;
    review.value.reviewedQuestionIds = review.value.reviewedQuestionIds.filter(item => item !== id);
    review.value.returnedQuestionIds = [...new Set([...(review.value.returnedQuestionIds ?? []), id])];
    await persistDraft(); message.value = "本题已退回修改，修订并重新审核后才能发布。";
  }); }
  async function saveOutline(outline: PassageOutline) { return run(async () => {
    if (!review.value) throw Error("请重新进入候选题库。");
    await persistDraft();
    const candidate = reviseOutline(review.value, outline, identity("revision"));
    await services.saveReview(candidate, current);
    review.value = candidate; savedReview.value = JSON.stringify(candidate); editingOutline.value = false;
    reviewIndex.value = Math.max(0, candidate.package.questions.findIndex(question => !candidate.reviewedQuestionIds.includes(question.id)));
    message.value = "知识块与关卡修改已保存，请重新确认教材安排并审核相关题目。";
  }); }
  async function approveAndNext() { await run(async () => {
    toggleReviewed(true); await persistDraft();
    const pending = reviewGroupQuestions.value.filter(({ question }) => !review.value!.reviewedQuestionIds.includes(question.id));
    const next = pending.find(item => item.index > reviewIndex.value) ?? pending[0];
    if (next) reviewIndex.value = next.index;
    else {
      const remaining = review.value!.package.questions.length - review.value!.reviewedQuestionIds.length;
      message.value = remaining ? `这一组已审核完成，其他分组还有 ${remaining} 道待审核。` : "全部题目已审核，请核对音频并发布。";
    }
  }); }
  function filterReview(filter: "all" | "pending" | "returned") {
    reviewFilter.value = filter;
    if (!reviewQuestions.value.some(item => item.index === reviewIndex.value)) reviewIndex.value = reviewQuestions.value[0]?.index ?? reviewIndex.value;
  }
  function groupReview() {
    const level = review.value?.package.levels.find(level => level.id === reviewLevel.value);
    if (level && ![...level.newGoalIds, ...level.reviewGoalIds].includes(reviewGoal.value)) reviewGoal.value = "all";
    filterReview(reviewFilter.value);
  }
  function materialChanged() { review.value = null; savedReview.value = "null"; }
  async function addLearner(nickname: string) { await run(async () => { await persistInput(); await persistDraft();
    await catalog.addLearner(nickname); sessionId.value = null; await refreshDirectory(); }); }
  async function boot() {
    await run(async () => {
      await refreshDirectory(); await store.load(); if (!current()) return;
      data.value = store.snapshot(); await checkAudio(); if (!current()) return;
      bindManager(courseId.value); ready.value = true;
    });
  }
  async function refreshContext() {
    clock.value = new Date().toISOString();
    await refreshDirectory(); data.value = await services.state.refresh(); await checkAudio();
    // A settings detour keeps the same learner/course/session. Detach only when
    // the refreshed context no longer owns it (for example after a publication).
    if (sessionId.value && (!session.value || session.value.status === "retired")) {
      sessionId.value = null;
      if (view.value === "practice") view.value = "home";
    }
  }
  const recordingListener = isAndroid ? native.addListener("recordingStopped", event => {
    if (event.reason !== "user" && recording.value && (!event.learnerId || event.learnerId === learner.value?.id)) {
      recording.value = false; error.value = "录音已中断，请重新录制。已保存的上一条录音保留。";
    }
  }) : undefined;
  watch(recordingScope, () => {
    if (recording.value) { recording.value = false; void native.cancelRecording().catch(() => {}); }
  }, { flush: "sync" });
  const clockTimer = setInterval(() => { if (current() && workspace.visible.value) clock.value = new Date().toISOString(); }, 60_000);
  onScopeDispose(() => { disposed = true; jobEpoch++; playbackEpoch++; playing.value = false; stopSubscription(); void requests.dispose();
    clearInterval(clockTimer);
    if (recordPlayback) { recordPlayback = false; void native.stopAudio().catch(() => {}); }
    void recordingListener?.then(listener => listener.remove()).catch(() => {});
    if (recording.value) { recording.value = false; void native.cancelRecording().catch(() => {}); }
    pool.forEach(item => item.scope.stop()); pool.clear(); });
  void boot();
  return { mode, ready, busy, generating, playing, error, message, view, settingsOrigin, directory, learner, courseId, course, pkg, publication,
    data, report, session, question, questionPackage, item, feedback, response, originalOpen, hintOpen, activeRun, audioAvailable, candidateAvailable,
    summary, reviewDue, recording, microphoneDenied, toggleRecording, hearRecording, rateSpeaking,
    baseSpeech, processingAudio, candidateAudio: computed(() => reactive(candidateAudio.value)), managedId, managed, material, review, reviewIndex, reviewQuestion, publishedManaged,
    editingQuestion, editingOutline, reviewDirty, reviewFilter, reviewLevel, reviewGoal, reviewLesson, groupReview, reviewGroupQuestions, reviewQuestions, saveQuestion, saveOutline, returnQuestion, approveAndNext, filterReview,
    navigate, selectLearner, selectCourse, start, submit, next, inputChanged, reveal, play, stopPlayback, openManager, saveMaterial,
    generate, cancelGeneration, publish, toggleReviewed, materialChanged, saveReviewDraft, addLearner, prepareLeave, refreshContext, run, boot };
}
