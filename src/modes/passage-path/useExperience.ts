import { computed, effectScope, inject, onScopeDispose, reactive, ref, watch } from "vue";
import type { CatalogSnapshot, MaterialInput } from "../../../packages/learning-modes/catalog";
import type { PassagePackage, PassageResponse, PassageReview } from "../../../packages/learning-modes/passage-path/model";
import { emptyPassageState } from "../../../packages/learning-modes/passage-path/state";
import { compilePassagePackage, makePassageAudioManifest } from "../../../packages/learning-modes/passage-path/authoring";
import { generatePassageCandidate } from "../../../packages/learning-modes/passage-path/prompts";
import { passageReport } from "../../../packages/learning-modes/passage-path/reporting";
import { questionFor, packageFor } from "../../../packages/learning-modes/passage-path/references";
import { copy } from "../../../packages/learning-modes/passage-path/validation";
import { passageServicesKey, passageSourceFromMaterial } from "./services";
import { catalogKey } from "../../platform/catalog";
import { useModeSelection } from "../../platform/mode-selection";
import { createContentRequests } from "../../platform/content-requests";
import { contentNative } from "../../platform/content";
import { useSpeech } from "../../platform/speech";

export type PassageView = "home" | "practice" | "source" | "parent" | "settings";
const identity = (prefix: string) => `${prefix}.${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
export function useExperience() {
  const services = inject(passageServicesKey)!, catalog = inject(catalogKey)!;
  const mode = useModeSelection(), requests = createContentRequests();
  const ready = ref(false), busy = ref(false), generating = ref(false), error = ref(""), message = ref("");
  const view = ref<PassageView>("home"), settingsOrigin = ref<PassageView>("home");
  const data = ref(emptyPassageState()), directory = ref<CatalogSnapshot>({ learners: [], activeLearnerId: null, defaultCourseId: "", learningCourseIds: {}, courses: [] });
  const learner = computed(() => directory.value.learners.find(item => item.id === directory.value.activeLearnerId));
  const courseId = computed(() => directory.value.learningCourseIds[learner.value?.id ?? ""] ?? directory.value.defaultCourseId);
  const course = computed(() => directory.value.courses.find(item => item.id === courseId.value));
  const publication = computed(() => data.value.publications.find(item => item.courseId === courseId.value));
  const pkg = computed(() => data.value.packages.find(item => item.courseId === courseId.value && item.revision === publication.value?.revision));
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
  const originalOpen = ref(false), hintOpen = ref(false);
  const report = computed(() => pkg.value && learner.value ? passageReport(data.value, learner.value.id, pkg.value.courseId, pkg.value.revision) : null);
  const activeRun = computed(() => data.value.sessions.some(item => item.status === "active" && item.learnerId === learner.value?.id && item.courseId === courseId.value));
  let disposed = false, jobEpoch = 0;
  const current = () => !disposed && mode.activeModeId.value === "passage-path";
  const store = services.createStore(() => ({ activeModeId: current() ? "passage-path" : "unloaded",
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
  let savedMaterial = "", savedReview = "";
  const review = ref<PassageReview | null>(null), reviewIndex = ref(0);
  const reviewQuestion = computed(() => review.value?.package.questions[reviewIndex.value]);
  const candidateAudio = computed(() => review.value ? audioFor(review.value.package) : baseSpeech);
  const publishedManaged = computed(() => data.value.publications.find(item => item.courseId === managedId.value));
  function bindManager(id: string) {
    managedId.value = id;
    const found = directory.value.courses.find(item => item.id === id);
    material.value = found ? copy({ title: found.title, subtitle: found.subtitle, sourceText: found.sourceText, images: found.images, supplementImages: found.supplementImages }) :
      { title: "", subtitle: "", sourceText: "", images: [], supplementImages: [] };
    savedMaterial = JSON.stringify(material.value);
    const candidates = data.value.candidates?.filter(item => item.package.courseId === id) ?? [];
    review.value = copy(candidates[candidates.length - 1] ?? null);
    savedReview = JSON.stringify(review.value); reviewIndex.value = 0;
  }
  async function refreshDirectory() { const value = await catalog.read(); if (current()) directory.value = value; }
  async function checkAudio() {
    for (const publication of data.value.publications) {
      if (!current()) return;
      const pack = data.value.packages.find(pack => pack.courseId === publication.courseId && pack.revision === publication.revision)!;
      await audioFor(pack).refreshCourse().catch(() => {});
    }
  }
  async function stopAudio() { await Promise.all([baseSpeech.stop(), ...[...pool.values()].map(item => item.speech.stop())]); }
  async function persistInput() {
    while (current()) {
      const run = session.value;
      if (run?.status !== "active" || run.feedbackAttemptId || JSON.stringify(run.input) === JSON.stringify(response.value)) return;
      await store.dispatch({ type: "input", sessionId: run.id, index: run.index, response: copy(response.value) });
    }
  }
  async function persistDraft() {
    while (current() && (savedMaterial !== JSON.stringify(material.value) || review.value && savedReview !== JSON.stringify(review.value))) {
      if (savedMaterial !== JSON.stringify(material.value)) {
        const captured = copy(material.value);
        if (!managedId.value) managedId.value = await catalog.createMaterial(captured);
        else await catalog.updateMaterial(managedId.value, captured);
        savedMaterial = JSON.stringify(captured); await refreshDirectory();
      }
      if (review.value && savedReview !== JSON.stringify(review.value)) {
        const captured = copy(review.value);
        await services.saveReview(captured, current); savedReview = JSON.stringify(captured);
      }
    }
  }
  async function prepareLeave() {
    if (busy.value || generating.value || processingAudio.value) throw Error("请先完成或暂停当前生成任务。");
    if (!ready.value) { await stopAudio(); return; }
    await persistInput(); await persistDraft(); await stopAudio();
  }
  async function run(action: () => Promise<void>) {
    if (busy.value || mode.busy.value || !current()) return false;
    if (generating.value || processingAudio.value) { error.value = "请先完成或暂停当前生成任务。"; return false; }
    busy.value = true; error.value = ""; message.value = "";
    try { await action(); return current(); }
    catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : String(failure); return false; }
    finally { if (!disposed) busy.value = false; }
  }
  async function navigate(next: PassageView) {
    if (generating.value) { error.value = "请先暂停当前生成任务。"; return; }
    await run(async () => {
      await persistInput(); await persistDraft(); await stopAudio();
      if (next === "source") {
        const active = data.value.sessions.find(item => item.status === "active" && item.learnerId === learner.value?.id && item.courseId === courseId.value);
        if (active) await store.dispatch({ type: "assist", sessionId: active.id, index: active.index });
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
  async function start(replayLevelId?: string) {
    await run(async () => {
      await persistInput(); await persistDraft(); await refreshDirectory(); await checkAudio();
      await store.dispatch({ type: "start", sessionId: identity("session"), seed: crypto.getRandomValues(new Uint32Array(1))[0]!, replayLevelId });
      if (!current()) return;
      sessionId.value = data.value.sessions.find(item => item.status === "active" && item.learnerId === learner.value?.id && item.courseId === courseId.value)!.id;
      response.value = copy(session.value!.input); view.value = "practice";
    });
  }
  async function submit() {
    await run(async () => {
      const run = session.value;
      if (!run) throw Error("请重新进入学习。");
      await checkAudio();
      await store.dispatch({ type: "submit", sessionId: run.id, index: run.index, attemptId: identity("attempt"), response: copy(response.value) });
    });
  }
  async function next() { await run(async () => {
    const run = session.value; if (!run) throw Error("会话已变更。");
    await store.dispatch({ type: "next", sessionId: run.id, index: run.index });
    if (session.value?.status === "completed") message.value = "这一轮完成了！路径进度已保存。稳定表现需要隔天独立练习。";
  }); }
  function inputChanged() { void persistInput().catch(failure => { if (current()) error.value = String(failure instanceof Error ? failure.message : failure); }); }
  async function reveal(kind: "source" | "hint") { await run(async () => {
    const run = session.value;
    if (run?.status === "active") await store.dispatch({ type: "assist", sessionId: run.id, index: run.index });
    if (kind === "source") originalOpen.value = true; else hintOpen.value = true;
  }); }
  async function play(text: string, pack: PassagePackage | undefined = questionPackage.value) { await run(async () => {
    if (!pack) throw Error("本课尚未开放音频。");
    if (!(await audioFor(pack).play(text))) throw Error("播放已停止。");
  }); }
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
      review.value = candidate; savedReview = JSON.stringify(candidate); reviewIndex.value = 0;
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
    sessionId.value = null; message.value = "本版本已开放。新版本路径独立记录，历史学习记录保留。";
  }); }
  function toggleReviewed(checked: boolean) {
    if (!review.value || !reviewQuestion.value) return;
    const id = reviewQuestion.value.id;
    review.value.reviewedQuestionIds = review.value.reviewedQuestionIds.filter(item => item !== id);
    if (checked) review.value.reviewedQuestionIds.push(id);
  }
  function materialChanged() { review.value = null; savedReview = "null"; }
  async function addLearner(nickname: string) { await run(async () => { await persistInput(); await persistDraft();
    await catalog.addLearner(nickname); sessionId.value = null; await refreshDirectory(); }); }
  async function boot() {
    await run(async () => {
      await refreshDirectory(); await store.load(); if (!current()) return;
      data.value = store.snapshot(); await checkAudio(); if (!current()) return;
      bindManager(courseId.value); ready.value = true;
    });
  }
  onScopeDispose(mode.beforeSwitch(prepareLeave));
  onScopeDispose(() => { disposed = true; jobEpoch++; stopSubscription(); void requests.dispose();
    pool.forEach(item => item.scope.stop()); pool.clear(); });
  void boot();
  return { mode, ready, busy, generating, error, message, view, settingsOrigin, directory, learner, courseId, course, pkg, publication,
    data, report, session, question, questionPackage, item, feedback, response, originalOpen, hintOpen, activeRun, audioAvailable,
    baseSpeech, processingAudio, candidateAudio: computed(() => reactive(candidateAudio.value)), managedId, managed, material, review, reviewIndex, reviewQuestion, publishedManaged,
    navigate, selectLearner, selectCourse, start, submit, next, inputChanged, reveal, play, openManager, saveMaterial,
    generate, cancelGeneration, publish, toggleReviewed, materialChanged, saveReviewDraft, addLearner, prepareLeave, run, boot };
}
