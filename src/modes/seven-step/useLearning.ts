import { LocalRepository } from "./repository";
import { computed, ref, watch, getCurrentScope, onScopeDispose } from "vue";
import {
  gradeExercise,
  projectLearning,
  buildReviewQueue,
  cellKey,
} from "../../../packages/learning-modes/seven-step/engine";
import type {
  Exercise,
  StageId,
  LearningEvent,
  Attempt,
  CellRef,
  GradeResult,
} from "../../../packages/learning-modes/seven-step/model";
import type { LearningUI } from "./domain";
import { stageDefinitions } from "../../../packages/learning-modes/seven-step/course";
import {
  starterRecord,
  validateCourseRecord,
  type CourseRecord,
} from "../../../packages/learning-modes/seven-step/authoring";
import { makeCourseAudioSpec } from "../../../packages/learning-modes/seven-step/audio";
import {
  emptyState,
  type LocalState,
  type PracticeRun,
} from "../../../packages/learning-modes/seven-step/state";
import { isAndroid, native } from "../../native";
import { useSpeech } from "../../platform/speech";
import {
  archiveCourse,
  restoreCourse as restoreArchivedCourse,
  purgeCourse as purgeArchivedCourse,
} from "../../../packages/learning-modes/seven-step/deletion";

const makeId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useLearning(): LearningUI {
  let disposed = false;
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
  let playbackSequence = 0;
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
  const courses = computed(() => [
    starterRecord,
    ...state.value.courses.filter((record) => !record.deletedAt),
  ]);
  const deletedCourses = computed(() =>
    state.value.courses
      .filter((record) => record.deletedAt)
      .slice()
      .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)),
  );
  const activeRecord = computed(
    () =>
      courses.value.find(
        (record) =>
          record.id === state.value.learningCourseIds[learner.value?.id ?? ""],
      ) ?? starterRecord,
  );
  const course = computed(() => activeRecord.value.package!.course);
  const exercises = computed(() => activeRecord.value.package!.exercises);
  const speech = useSpeech(
    computed(() => makeCourseAudioSpec(course.value, exercises.value)),
  );
  const allExposureTargets = computed(() =>
    exercises.value
      .filter((exercise) =>
        ["recall", "dictation"].includes(exercise.target.ability),
      )
      .map((exercise) => exercise.target),
  );
  const confirmed = computed(
    () =>
      !!learner.value &&
      state.value.confirmedCourses.some(
        (item) =>
          item.learnerId === learner.value!.id &&
          item.courseId === course.value.id &&
          item.version === course.value.version,
      ),
  );
  const projection = computed(() =>
    projectLearning(
      state.value.events,
      exercises.value,
      learner.value?.id ?? "",
      tick.value,
    ),
  );
  const history = computed(() =>
    projection.value.attempts
      .map((a) => ({
        ...a,
        exercise: exercises.value.find((e) => e.id === a.exerciseId)!,
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
      exercises.value.filter((e) => measured.has(cellKey(e.target))),
      tick.value,
    );
  });
  function stageResults(id: StageId) {
    const items = exercises.value.filter((e) => e.stageId === id);
    const stageRun = [...state.value.runs]
      .reverse()
      .find(
        (r) =>
          r.learnerId === learner.value?.id &&
          r.stageId === id &&
          r.courseId === course.value.id,
      );
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
    const initialView = view.value;
    error.value = "";
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
      if (initialView !== "parent" && view.value === initialView)
        view.value = "home";
  }
  async function renameLearner(name: string) {
    error.value = "";
    const nickname = name.trim();
    const id = learner.value?.id;
    if (!id || !nickname || nickname.length > 16) {
      error.value = "请输入 1–16 个字的昵称。";
      return;
    }
    if (
      await transaction((d) => {
        const profile = d.learners.find((item) => item.id === id);
        if (!profile) throw new Error("学习档案已变更，请重新选择。");
        profile.nickname = nickname;
      })
    )
      notice.value = "昵称已更新，学习记录保留。";
  }
  async function stopSpeech() {
    await operation(() => speech.stop());
  }
  async function clearRun() {
    playbackSequence++;
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
    const initialView = view.value;
    if (id === learner.value?.id) return;
    if (!state.value.learners.some((l) => l.id === id)) return;
    await clearRun();
    if (
      await transaction((d) => {
        d.activeLearnerId = id;
      })
    )
      if (initialView !== "parent" && view.value === initialView)
        view.value = "home";
  }
  async function confirmCourse() {
    const id = learner.value?.id;
    if (!id) return;
    if (
      await transaction((d) => {
        if (
          !d.confirmedCourses.some(
            (item) =>
              item.learnerId === id &&
              item.courseId === course.value.id &&
              item.version === course.value.version,
          )
        )
          d.confirmedCourses.push({
            learnerId: id,
            courseId: course.value.id,
            version: course.value.version,
          });
        if (
          course.value.id === starterRecord.id &&
          !d.confirmedLearnerIds.includes(id)
        )
          d.confirmedLearnerIds.push(id);
      })
    )
      notice.value = "已确认本课原文，可以开始练习了。";
  }
  async function saveCourse(record: CourseRecord): Promise<boolean> {
    error.value = "";
    const copy = JSON.parse(JSON.stringify(record)) as CourseRecord;
    try {
      validateCourseRecord(copy);
    } catch (failure) {
      error.value = errorText(failure);
      return false;
    }
    return transaction((d) => {
      if (
        copy.deletedAt ||
        d.courses.some((item) => item.id === copy.id && item.deletedAt) ||
        d.pendingCourseDeletions.some((job) => job.record.id === copy.id)
      )
        throw new Error("课程已删除，不能重新保存旧草稿。");
      const index = d.courses.findIndex((item) => item.id === copy.id);
      if (index >= 0 && d.courses[index]!.status === "published") {
        if (JSON.stringify(d.courses[index]) !== JSON.stringify(copy))
          throw new Error("已启用课程保持原版本，请新建课程保存变更。");
        return;
      }
      if (index < 0 && d.courses.filter((item) => !item.deletedAt).length >= 30)
        throw new Error("此设备最多保存 30 门自建课程。");
      if (index < 0 && d.courses.length >= 300)
        throw new Error("本机课程保存数量已达上限。");
      if (index < 0) d.courses.push(copy);
      else d.courses[index] = copy;
    });
  }
  async function assignCourse(id: string): Promise<boolean> {
    error.value = "";
    if (!learner.value) {
      error.value = "请先创建孩子档案。";
      return false;
    }
    if (view.value === "practice" || speech.courseGenerating.value) {
      error.value = "请先退出练习或暂停音频生成，再切换课程。";
      return false;
    }
    const record = courses.value.find(
      (item) => item.id === id && item.status === "published",
    );
    if (!record) {
      error.value = "课程尚未审核启用。";
      return false;
    }
    const learnerId = learner.value.id;
    await clearRun();
    const saved = await transaction((d) => {
      d.learningCourseIds[learnerId] = id;
      if (
        !d.confirmedCourses.some(
          (item) => item.learnerId === learnerId && item.courseId === id,
        )
      )
        d.confirmedCourses.push({
          learnerId,
          courseId: id,
          version: record.package!.course.version,
        });
    });
    if (saved) notice.value = "已设为当前孩子的学习课程，原课程进度保留。";
    return saved;
  }
  async function openLesson() {
    if (await exposure(allExposureTargets.value)) view.value = "lesson";
  }
  async function deleteCourse(id: string): Promise<boolean> {
    error.value = "";
    if (view.value === "practice" || speech.courseGenerating.value) {
      error.value = "请先退出练习或暂停音频生成，再删除课程。";
      return false;
    }
    if (
      !state.value.courses.some((item) => item.id === id && !item.deletedAt)
    ) {
      error.value = "只能删除自建课程，内置课程保留。";
      return false;
    }
    await clearRun();
    await speech.stop();
    const saved = await transaction((d) => {
      archiveCourse(d, id);
    });
    if (saved) {
      notice.value = "课程已移到已删除，内容、音频与学习记录保留，可随时恢复。";
    }
    return saved;
  }
  async function restoreCourse(id: string): Promise<boolean> {
    error.value = "";
    const saved = await transaction((d) => restoreArchivedCourse(d, id));
    if (saved) notice.value = "课程已恢复，原有学习进度和资源保留。";
    return saved;
  }
  let cleaningCourses = false;
  async function purgeCourse(id: string): Promise<boolean> {
    error.value = "";
    if (view.value === "practice" || speech.courseGenerating.value) {
      error.value = "请先退出练习或暂停音频生成，再彻底删除课程。";
      return false;
    }
    const saved = await transaction((d) => {
      purgeArchivedCourse(d, id);
    });
    if (saved) {
      notice.value = "课程及本课学习记录已彻底删除，无法恢复。";
      await retryCourseCleanup();
    }
    return saved;
  }
  async function retryCourseCleanup() {
    if (cleaningCourses) return;
    if (error.value.includes("本机资源清理")) error.value = "";
    cleaningCourses = true;
    try {
      for (const job of [...state.value.pendingCourseDeletions]) {
        try {
          if (isAndroid)
            await native.deleteCourseResources({
              ...(job.record.package
                ? {
                    course: makeCourseAudioSpec(
                      job.record.package.course,
                      job.record.package.exercises,
                    ),
                  }
                : {}),
              images: job.images,
              recordings: job.recordings,
            });
          if (
            !(await transaction((d) => {
              d.pendingCourseDeletions = d.pendingCourseDeletions.filter(
                (item) => item.record.id !== job.record.id,
              );
            }))
          )
            break;
        } catch (failure) {
          error.value = `课程已删除，本机资源清理未完成，可重试或下次启动自动处理：${errorText(failure)}`;
        }
      }
    } finally {
      cleaningCourses = false;
    }
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
          r.courseId === course.value.id &&
          r.index < r.exerciseIds.length,
      );
    const stored: PracticeRun = previous ?? {
      id: makeId(),
      learnerId: learner.value.id,
      courseId: course.value.id,
      stageId,
      exerciseIds: items.map((e) => e.id),
      index: 0,
      label,
      hints: {},
      answer: "",
      selectedIds: [],
      recordingPath: null,
    };
    const first = exercises.value.find(
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
      (id) => exercises.value.find((e) => e.id === id)!,
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
      exercises.value.filter((e) => e.stageId === id),
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
      await speech.play(text);
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
  async function playRecording(path: string): Promise<boolean> {
    error.value = "";
    const learnerId = learner.value?.id;
    const sequence = ++playbackSequence;
    try {
      if (!isAndroid)
        throw new Error("录音存放在 Android 设备中，请在原设备播放。");
      if (recording.value) throw new Error("请先结束当前录音。");
      await native.playRecording({ path });
      return sequence === playbackSequence && learner.value?.id === learnerId;
    } catch (failure) {
      if (sequence === playbackSequence && learner.value?.id === learnerId)
        error.value = errorText(failure);
      return false;
    }
  }
  async function stopPlayback() {
    playbackSequence++;
    if (isAndroid) {
      try {
        await native.stopAudio();
      } catch (failure) {
        error.value = errorText(failure);
      }
    }
  }
  async function reviewAttempt(
    id: string,
    passed: boolean,
    expectedRevision?: number,
  ) {
    error.value = "";
    const item = history.value.find((a) => a.id === id);
    if (!item || busy.value) return;
    if (item.exercise.kind !== "oral" || !item.recordingPath) return;
    const revision = expectedRevision ?? item.reviewRevision;
    if (revision !== item.reviewRevision) {
      error.value = "这条评价已更新，请重新查看后再确认。";
      return;
    }
    if (
      await transaction((d) => {
        const current = projectLearning(
          d.events,
          exercises.value,
          item.learnerId,
          new Date().toISOString(),
        ).attempts.find((attempt) => attempt.id === id);
        if (!current || current.reviewRevision !== revision)
          throw new Error("这条评价已更新，请重新查看后再确认。");
        d.events.push({
          id: makeId(),
          learnerId: item.learnerId,
          type: "review",
          at: new Date().toISOString(),
          attemptId: id,
          passed,
          expectedRevision: revision,
        });
      })
    )
      notice.value = passed
        ? "家长确认已保存。跨日练习后再判断是否掌握。"
        : "复核已保存，这段内容会继续安排练习。";
  }
  async function deleteLearner() {
    const initialView = view.value;
    error.value = "";
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
        d.confirmedCourses = d.confirmedCourses.filter(
          (item) => item.learnerId !== id,
        );
        delete d.learningCourseIds[id];
        d.activeLearnerId = d.learners[0]?.id ?? null;
      })
    ) {
      if (isAndroid) await purgePendingRecordings();
      if (initialView !== "parent" && view.value === initialView)
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
      if (disposed) return;
      state.value = value;
      ready.value = true;
      if (isAndroid) void purgePendingRecordings();
      void retryCourseCleanup();
    })
    .catch((e) => {
      error.value = `无法读取学习记录：${errorText(e)}`;
    });
  const recordingSubscription = isAndroid
    ? native.addListener("recordingStopped", (event) => {
      if (!disposed && event.reason !== "user" && recording.value) {
        recording.value = false;
        recordingPath.value = null;
        notice.value = "录音已中断或达到时长上限，请重新录制后提交。";
      }
    })
    : null;
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      void recordingSubscription?.then((handle) => handle.remove()).catch(() => {});
    });
  return {
    speech,
    ready,
    busy,
    error,
    notice,
    view,
    learners,
    learner,
    course,
    courses,
    deletedCourses,
    exercises,
    sourceImages: computed(() => activeRecord.value.images),
    saveCourse,
    assignCourse,
    deleteCourse,
    restoreCourse,
    purgeCourse,
    retryCourseCleanup,
    pendingCourseCleanupCount: computed(
      () => state.value.pendingCourseDeletions.length,
    ),
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
    reviewLog: computed(() =>
      state.value.events.filter(
        (event): event is Extract<LearningEvent, { type: "review" }> =>
          event.type === "review" && event.learnerId === learner.value?.id,
      ),
    ),
    skills: computed(() => projection.value.skills),
    storageLabel: isAndroid
      ? "此设备 · SQLite 本地存储"
      : "浏览器预览 · 本机存储",
    addLearner,
    renameLearner,
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
    stopPlayback,
    reviewAttempt,
    refreshLearning: () => {
      tick.value = new Date().toISOString();
    },
    deleteLearner,
    dismissError: () => {
      error.value = "";
    },
  };
}
