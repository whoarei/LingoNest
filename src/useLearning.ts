import { computed, ref, watch } from "vue";
import {
  gradeExercise,
  projectLearning,
  buildReviewQueue,
  cellKey,
} from "../packages/learning-engine/src";
import type {
  Exercise,
  StageId,
  LearningEvent,
  Attempt,
  CellRef,
  GradeResult,
} from "../packages/learning-engine/src/model";
import type { LearningUI } from "./domain";
import {
  course,
  exercises,
  stageDefinitions,
  allExposureTargets,
} from "./course";
import {
  LocalRepository,
  emptyState,
  type LocalState,
  type PracticeRun,
} from "./storage";
import { isAndroid, native } from "./native";

const makeId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useLearning(): LearningUI {
  const repository = new LocalRepository();
  const state = ref<LocalState>(emptyState());
  const ready = ref(false),
    busy = ref(false),
    error = ref(""),
    notice = ref("");
  const view = ref<LearningUI["view"]["value"]>("home");
  const answer = ref(""),
    selectedIds = ref<string[]>([]),
    hintShown = ref(false);
  const feedback = ref<GradeResult | null>(null),
    recording = ref(false),
    recordingPath = ref<string | null>(null);
  const run = ref<Exercise[]>([]),
    index = ref(0),
    runLabel = ref(""),
    hintLevel = ref<0 | 1 | 3>(0);
  let sessionId = makeId();
  let saveQueue: Promise<void> = Promise.resolve();
  let submitInFlight = false;
  let nextInFlight = false;
  let pendingWrites = 0;
  const startWall = Date.now(),
    startMonotonic = performance.now();
  function clockSuspect(now: number) {
    return (
      (state.value.lastObservedAt !== null &&
        now + 300_000 < Date.parse(state.value.lastObservedAt)) ||
      Math.abs(now - startWall - (performance.now() - startMonotonic)) > 300_000
    );
  }
  const tick = ref(new Date().toISOString());
  const learners = computed(() => state.value.learners);
  const learner = computed(
    () =>
      state.value.learners.find((l) => l.id === state.value.activeLearnerId) ??
      null,
  );
  const confirmed = computed(
    () =>
      !!learner.value &&
      state.value.confirmedLearnerIds.includes(learner.value.id),
  );
  const projection = computed(() =>
    projectLearning(
      state.value.events,
      exercises,
      learner.value?.id ?? "",
      tick.value,
    ),
  );
  const history = computed(() =>
    projection.value.attempts
      .map((a) => ({
        ...a,
        exercise: exercises.find((e) => e.id === a.exerciseId)!,
      }))
      .filter((a) => a.exercise)
      .reverse(),
  );
  const pending = computed(() =>
    history.value.filter((a) => a.grade.status === "needs_review"),
  );
  const queue = computed(() => {
    const measured = new Set(
      projection.value.skills
        .filter((s) => s.evidenceCount > 0)
        .map((s) => s.key),
    );
    return buildReviewQueue(
      projection.value,
      exercises.filter((e) => measured.has(cellKey(e.target))),
      tick.value,
    );
  });
  function stageResults(id: StageId) {
    const items = exercises.filter((e) => e.stageId === id);
    const stageRun = [...state.value.runs]
      .reverse()
      .find((r) => r.learnerId === learner.value?.id && r.stageId === id);
    const targets = [...new Set(items.map((e) => cellKey(e.target)))];
    const results = targets.map((key) =>
      history.value.find(
        (a) =>
          a.sessionId === stageRun?.id &&
          a.exercise.stageId === id &&
          cellKey(a.exercise.target) === key &&
          a.hintLevel === 0 &&
          a.firstTest,
      ),
    );
    const done = results.filter(
      (a) =>
        a &&
        (a.grade.passed === true ||
          (a.grade.status === "needs_review" && !!a.recordingPath)),
    ).length;
    return {
      total: targets.length,
      done,
      verified: results.every((a) => a?.grade.passed === true),
    };
  }
  const stages = computed(() =>
    stageDefinitions.map((def, i) => {
      const progress = stageResults(def.id);
      const previousComplete = stageDefinitions
        .slice(0, i)
        .every((previous) => {
          const p = stageResults(previous.id);
          return p.done === p.total;
        });
      return {
        ...def,
        ...progress,
        available: confirmed.value && previousComplete,
      };
    }),
  );
  const stats = computed(() => ({
    todayAttempts: history.value.filter(
      (a) => a.localDate === localDate(new Date(tick.value)),
    ).length,
    pendingReviews: pending.value.length,
    dueCount: projection.value.skills.filter(
      (s) =>
        s.evidenceCount > 0 &&
        s.dueAt !== null &&
        s.dueAt <= tick.value &&
        s.eligibleAt !== null &&
        s.eligibleAt <= tick.value,
    ).length,
    measured: projection.value.skills.filter((s) => s.evidenceCount > 0).length,
    mastered: projection.value.skills.filter((s) => s.status === "mastered")
      .length,
    completedStages: stages.value.filter((s) => s.done === s.total).length,
  }));
  const currentExercise = computed(() => run.value[index.value] ?? null);
  const practice = computed(() => ({
    position: index.value,
    total: run.value.length,
    label: runLabel.value,
    finished: run.value.length > 0 && index.value >= run.value.length,
  }));

  async function transaction(
    change: (draft: LocalState) => void,
  ): Promise<boolean> {
    if (!ready.value) return false;
    let ok = false;
    pendingWrites += 1;
    busy.value = true;
    const action = saveQueue.then(async () => {
      busy.value = true;
      try {
        const draft: LocalState = JSON.parse(JSON.stringify(state.value));
        const priorCount = draft.events.length;
        change(draft);
        // Untrusted wall-clock changes cannot introduce delay anchors through answer exposure.
        if (clockSuspect(Date.now()))
          draft.events = draft.events.filter(
            (event, i) => i < priorCount || event.type !== "exposure",
          );
        await repository.save(draft);
        state.value = draft;
        tick.value = new Date().toISOString();
        ok = true;
      } catch (e) {
        error.value = `保存未完成：${errorText(e)}`;
      } finally {
        pendingWrites -= 1;
        busy.value = pendingWrites > 0;
      }
    });
    saveQueue = action.catch(() => {});
    await action;
    return ok;
  }
  async function exposure(targets: CellRef[]): Promise<boolean> {
    const id = learner.value?.id;
    if (!id || !targets.length) return true;
    return transaction((d) => {
      d.events.push({
        id: makeId(),
        learnerId: id,
        type: "exposure",
        at: new Date().toISOString(),
        targets,
      });
    });
  }
  function savedRun(draft: LocalState) {
    return draft.runs.find((r) => r.id === sessionId);
  }
  function copyDraft(saved: PracticeRun) {
    saved.answer = answer.value;
    saved.selectedIds = [...selectedIds.value];
    saved.recordingPath = recordingPath.value;
    if (currentExercise.value)
      saved.hints[currentExercise.value.id] = hintLevel.value;
  }
  async function operation(action: () => Promise<void>) {
    error.value = "";
    try {
      await action();
    } catch (e) {
      error.value = errorText(e);
    }
  }
  async function addLearner(name: string) {
    const nickname = name.trim();
    if (!nickname || nickname.length > 16) {
      error.value = "请输入 1–16 个字的昵称。";
      return;
    }
    if (state.value.learners.length >= 8) {
      error.value = "此设备最多保留 8 个学习档案。";
      return;
    }
    const id = makeId();
    if (
      await transaction((d) => {
        d.learners.push({ id, nickname, createdAt: new Date().toISOString() });
        d.activeLearnerId = id;
      })
    )
      view.value = "home";
  }
  async function stopSpeech() {
    if (isAndroid) await operation(() => native.stopSpeech());
    else window.speechSynthesis?.cancel();
  }
  async function clearRun() {
    if (isAndroid)
      await operation(async () => {
        await native.cancelRecording();
        await native.stopAudio();
      });
    else window.speechSynthesis?.cancel();
    recording.value = false;
    run.value = [];
    resetAnswer();
  }
  async function selectLearner(id: string) {
    if (!state.value.learners.some((l) => l.id === id)) return;
    await clearRun();
    if (
      await transaction((d) => {
        d.activeLearnerId = id;
      })
    )
      view.value = "home";
  }
  async function confirmCourse() {
    const id = learner.value?.id;
    if (!id) return;
    if (
      await transaction((d) => {
        if (!d.confirmedLearnerIds.includes(id)) d.confirmedLearnerIds.push(id);
      })
    )
      notice.value = "已确认本课原文，可以开始练习了。";
  }
  async function openLesson() {
    if (await exposure(allExposureTargets)) view.value = "lesson";
  }
  function resetAnswer() {
    answer.value = "";
    selectedIds.value = [];
    hintShown.value = false;
    hintLevel.value = 0;
    feedback.value = null;
    recordingPath.value = null;
    recording.value = false;
  }
  async function begin(
    items: Exercise[],
    label: string,
    stageId: StageId | null,
  ) {
    if (!confirmed.value) {
      await openLesson();
      notice.value = "请先与家长核对课文原图并确认。";
      return;
    }
    if (busy.value || !learner.value) return;
    const previous = [...state.value.runs]
      .reverse()
      .find(
        (r) =>
          r.learnerId === learner.value?.id &&
          r.stageId === stageId &&
          r.index < r.exerciseIds.length,
      );
    const stored: PracticeRun = previous ?? {
      id: makeId(),
      learnerId: learner.value.id,
      stageId,
      exerciseIds: items.map((e) => e.id),
      index: 0,
      label,
      hints: {},
      answer: "",
      selectedIds: [],
      recordingPath: null,
    };
    const first = exercises.find(
      (e) => e.id === stored.exerciseIds[stored.index],
    );
    if (
      !(await transaction((d) => {
        if (!previous) d.runs.push(stored);
        if (first?.stageId === "S4" || first?.kind === "order")
          d.events.push({
            id: makeId(),
            type: "exposure",
            learnerId: stored.learnerId,
            at: new Date().toISOString(),
            targets: first.exposureTargets ?? [],
          });
      }))
    )
      return;
    run.value = stored.exerciseIds.map(
      (id) => exercises.find((e) => e.id === id)!,
    );
    index.value = stored.index;
    sessionId = stored.id;
    runLabel.value = stored.label;
    resetAnswer();
    answer.value = stored.answer;
    selectedIds.value = [...stored.selectedIds];
    recordingPath.value = stored.recordingPath;
    hintLevel.value = first ? (stored.hints[first.id] ?? 0) : 0;
    hintShown.value = hintLevel.value > 0;
    feedback.value =
      history.value.find(
        (a) => a.sessionId === sessionId && a.exerciseId === first?.id,
      )?.grade ?? null;
    view.value = "practice";
  }
  function startStage(id: StageId) {
    if (confirmed.value && !stages.value.find((s) => s.id === id)?.available) {
      notice.value = "先完成前面的练习，再继续这一站。";
      return;
    }
    void begin(
      exercises.filter((e) => e.stageId === id),
      stageDefinitions.find((s) => s.id === id)?.title ?? "练习",
      id,
    );
  }
  function startReview() {
    tick.value = new Date().toISOString();
    if (!queue.value.length) {
      notice.value = "暂时没有需要复习的内容。明天再来看看吧。";
      return;
    }
    void begin(queue.value, "今日复习", null);
  }
  async function submit() {
    const ex = currentExercise.value,
      profile = learner.value;
    if (!ex || !profile || feedback.value || busy.value || submitInFlight)
      return;
    if (recording.value) {
      error.value = "请先结束录音，再提交。";
      return;
    }
    if (
      ex.kind === "oral"
        ? !recordingPath.value
        : ["choice", "order"].includes(ex.kind)
          ? selectedIds.value.length === 0
          : !answer.value.trim()
    ) {
      error.value =
        ex.kind === "oral" ? "请先完成一段录音。" : "先试着作答，再提交吧。";
      return;
    }
    submitInFlight = true;
    const submittedAt = new Date().toISOString();
    const suspect = clockSuspect(Date.parse(submittedAt));
    const grade = gradeExercise(ex, {
      answer: answer.value,
      selectedIds: [...selectedIds.value],
      recordingPath: recordingPath.value ?? undefined,
    });
    const attempt: Attempt = {
      id: makeId(),
      clientEventId: makeId(),
      learnerId: profile.id,
      sessionId,
      exerciseId: ex.id,
      answer: answer.value,
      selectedIds: [...selectedIds.value],
      recordingPath: recordingPath.value,
      hintLevel: hintLevel.value,
      submittedAt,
      localDate: localDate(new Date(submittedAt)),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      clockStatus: suspect ? "suspect" : "normal",
      firstTest: !history.value.some(
        (a) => a.sessionId === sessionId && a.exerciseId === ex.id,
      ),
      grade,
    };
    const event: LearningEvent = {
      id: makeId(),
      learnerId: profile.id,
      at: submittedAt,
      type: "attempt",
      attempt,
    };
    if (
      await transaction((d) => {
        d.events.push(event);
        if (grade.status === "scored" && !suspect)
          d.events.push({
            id: makeId(),
            type: "exposure",
            learnerId: profile.id,
            at: submittedAt,
            targets: [ex.target, ...(ex.exposureTargets ?? [])],
          });
        const active = savedRun(d);
        if (active) copyDraft(active);
        if (!suspect && (!d.lastObservedAt || submittedAt > d.lastObservedAt))
          d.lastObservedAt = submittedAt;
      })
    ) {
      feedback.value = grade;
      error.value = "";
      if (suspect)
        notice.value = "设备时间发生变化，本次成绩保留，但不计跨日掌握证据。";
    }
    submitInFlight = false;
  }
  async function next() {
    if (!feedback.value || busy.value || nextInFlight) return;
    nextInFlight = true;
    try {
      await stopSpeech();
      const nextIndex = index.value + 1,
        ex = run.value[nextIndex];
      if (
        !(await transaction((d) => {
          const active = savedRun(d);
          if (active) {
            active.index = nextIndex;
            active.answer = "";
            active.selectedIds = [];
            active.recordingPath = null;
          }
          if ((ex?.stageId === "S4" || ex?.kind === "order") && learner.value)
            d.events.push({
              id: makeId(),
              type: "exposure",
              learnerId: learner.value.id,
              at: new Date().toISOString(),
              targets: ex.exposureTargets ?? [],
            });
        }))
      )
        return;
      index.value = nextIndex;
      resetAnswer();
    } finally {
      nextInFlight = false;
    }
  }
  async function revealHint() {
    const ex = currentExercise.value;
    if (!ex || feedback.value) return;
    const level = Math.max(hintLevel.value, 1) as 1 | 3;
    if (
      await transaction((d) => {
        d.events.push({
          id: makeId(),
          type: "exposure",
          learnerId: learner.value!.id,
          at: new Date().toISOString(),
          targets: [ex.target, ...(ex.exposureTargets ?? [])],
        });
        const active = savedRun(d);
        if (active) active.hints[ex.id] = level;
      })
    ) {
      hintShown.value = true;
      hintLevel.value = level;
    }
  }
  async function revealReference() {
    const ex = currentExercise.value;
    if (!ex) return;
    if (
      await transaction((d) => {
        d.events.push({
          id: makeId(),
          type: "exposure",
          learnerId: learner.value!.id,
          at: new Date().toISOString(),
          targets: [ex.target, ...(ex.exposureTargets ?? [])],
        });
        const active = savedRun(d);
        if (active) active.hints[ex.id] = 3;
      })
    ) {
      hintLevel.value = 3;
      hintShown.value = true;
    }
  }
  async function speak(text: string) {
    if (recording.value) {
      error.value = "请先结束录音再播放。";
      return;
    }
    const ex = view.value === "practice" ? currentExercise.value : null;
    if (ex && ["S4", "S5"].includes(ex.stageId) && !feedback.value) {
      await revealReference();
      if (hintLevel.value !== 3) return;
    } else if (ex?.exposureTargets?.length) {
      if (!(await exposure(ex.exposureTargets))) return;
    }
    await operation(async () => {
      if (isAndroid) await native.speak({ text });
      else {
        if (!window.speechSynthesis)
          throw new Error("此浏览器不支持朗读，请使用 Android 版本。");
        const voice = speechSynthesis
          .getVoices()
          .find((v) => v.lang.startsWith("en") && v.localService);
        if (!voice)
          throw new Error(
            "设备没有可用的离线英语音色。请安装英语语音包，或请家长朗读。",
          );
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 0.85;
        speechSynthesis.speak(utterance);
      }
    });
  }
  async function toggleRecording() {
    if (!isAndroid) {
      error.value =
        "录音请在 Android 应用中使用。浏览器用于界面与文字练习预览。";
      return;
    }
    if (busy.value || feedback.value || !learner.value) return;
    busy.value = true;
    const wasRecording = recording.value;
    await operation(async () => {
      if (wasRecording) {
        recordingPath.value = (await native.stopRecording()).path;
        recording.value = false;
        await transaction((d) => {
          const active = savedRun(d);
          if (active) copyDraft(active);
        });
      } else {
        await native.stopSpeech();
        await native.startRecording({ learnerId: learner.value!.id });
        recording.value = true;
        recordingPath.value = null;
      }
    });
    if (wasRecording) recording.value = false;
    busy.value = false;
  }
  async function playRecording(path: string) {
    await operation(async () => {
      if (!isAndroid)
        throw new Error("录音存放在 Android 设备中，请在原设备播放。");
      if (recording.value) throw new Error("请先结束当前录音。");
      await native.playRecording({ path });
    });
  }
  async function reviewAttempt(id: string, passed: boolean) {
    const item = pending.value.find((a) => a.id === id);
    if (!item || busy.value) return;
    if (
      await transaction((d) => {
        d.events.push({
          id: makeId(),
          learnerId: item.learnerId,
          type: "review",
          at: new Date().toISOString(),
          attemptId: id,
          passed,
          expectedRevision: item.reviewRevision,
        });
      })
    )
      notice.value = passed
        ? "家长确认已保存。跨日练习后再判断是否掌握。"
        : "复核已保存，这段内容会继续安排练习。";
  }
  async function deleteLearner() {
    const id = learner.value?.id;
    if (!id || busy.value) return;
    await clearRun();
    if (
      await transaction((d) => {
        d.learners = d.learners.filter((l) => l.id !== id);
        d.events = d.events.filter((e) => e.learnerId !== id);
        d.runs = d.runs.filter((r) => r.learnerId !== id);
        if (isAndroid && !d.pendingDeletions.includes(id))
          d.pendingDeletions.push(id);
        d.confirmedLearnerIds = d.confirmedLearnerIds.filter((l) => l !== id);
        d.activeLearnerId = d.learners[0]?.id ?? null;
      })
    ) {
      if (isAndroid) await purgePendingRecordings();
      view.value = "home";
      notice.value = "该学习档案和学习记录已删除。";
    }
  }
  async function purgePendingRecordings() {
    for (const id of state.value.pendingDeletions) {
      try {
        await native.deleteRecordings({ learnerId: id });
        await transaction((d) => {
          d.pendingDeletions = d.pendingDeletions.filter(
            (value) => value !== id,
          );
        });
      } catch (e) {
        error.value = `档案已删除，录音清理未完成，将在下次启动重试：${errorText(e)}`;
      }
    }
  }
  watch(view, (nextView, previousView) => {
    tick.value = new Date().toISOString();
    if (previousView === "practice" && nextView !== "practice") {
      void transaction((d) => {
        const active = savedRun(d);
        if (active) copyDraft(active);
      });
      void stopSpeech();
      if (isAndroid && recording.value)
        void operation(async () => {
          await native.cancelRecording();
          recording.value = false;
        });
    }
  });
  void repository
    .load()
    .then((value) => {
      state.value = value;
      ready.value = true;
      if (isAndroid) void purgePendingRecordings();
    })
    .catch((e) => {
      error.value = `无法读取学习记录：${errorText(e)}`;
    });
  if (isAndroid)
    void native.addListener("recordingStopped", (event) => {
      if (event.reason !== "user" && recording.value) {
        recording.value = false;
        recordingPath.value = null;
        notice.value = "录音已中断或达到时长上限，请重新录制后提交。";
      }
    });
  return {
    ready,
    busy,
    error,
    notice,
    view,
    learners,
    learner,
    course,
    confirmed,
    stages,
    currentExercise,
    answer,
    selectedIds,
    hintShown,
    feedback,
    recording,
    recordingPath,
    practice,
    stats,
    history,
    pending,
    skills: computed(() => projection.value.skills),
    storageLabel: isAndroid
      ? "此设备 · SQLite 本地存储"
      : "浏览器预览 · 本机存储",
    addLearner,
    selectLearner,
    confirmCourse,
    openLesson,
    startStage,
    startReview,
    submit,
    next,
    revealHint,
    revealReference,
    speak,
    stopSpeech,
    toggleRecording,
    playRecording,
    reviewAttempt,
    deleteLearner,
    dismissError: () => {
      error.value = "";
    },
  };
}
