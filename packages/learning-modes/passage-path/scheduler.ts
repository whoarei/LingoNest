import type { PassageLesson, PassagePackage, PassageQuestion, PassageState, RuntimeContext, SessionItem, SelectionReason } from "./model";
import { lessonQuestion } from "./curriculum";
import { projectGoalProgress } from "./progress";
import { makePassageAudioManifest } from "./authoring";
import { questionFingerprint } from "./grading";
import { packageFor, referenceKey } from "./references";
import { requireValid } from "./validation";

export function randomFromSeed(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(value ^ value >>> 15, 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, 61 | mixed);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
export function sessionItem(pkg: PassagePackage, question: PassageQuestion, reason: SelectionReason, random: () => number): SessionItem {
  const ids = question.kind === "cloze" || question.kind === "speak" ? [] : (question.kind === "order" ? question.tokens : question.options).map(item => item.id);
  let displayIds = shuffled(ids, random);
  if (question.kind === "order" && JSON.stringify(displayIds) === JSON.stringify(question.correctTokenIds))
    displayIds = [...displayIds.slice(1), displayIds[0]!];
  return { courseId: pkg.courseId, revision: pkg.revision, questionId: question.id, reason, displayIds };
}
export function trustedClock(state: PassageState, context: RuntimeContext) {
  return context.clock.trusted && (!state.lastObservedAt || Date.parse(context.clock.at) >= Date.parse(state.lastObservedAt));
}
export function selectionTime(state: PassageState, context: RuntimeContext) {
  return trustedClock(state, context) ? Date.parse(context.clock.at) : state.lastObservedAt ? Date.parse(state.lastObservedAt) : -Infinity;
}

/** Reserves required coverage first. A ratio never displaces a new goal's introduction. */
export function scheduleQuestions(state: PassageState, context: RuntimeContext, pkg: PassagePackage, levelId: string | null, seed: number, lesson?: PassageLesson): SessionItem[] {
  const random = randomFromSeed(seed);
  const level = levelId === null ? null : pkg.levels.find(item => item.id === levelId);
  requireValid(levelId === null || level, "关卡不存在。");
  const ownProgress = projectGoalProgress(state, context.learnerId, pkg);
  const progress = new Map([[JSON.stringify([pkg.courseId, pkg.revision]), ownProgress]]);
  const progressFor = (origin: PassagePackage) => {
    const key = JSON.stringify([origin.courseId, origin.revision]);
    if (!progress.has(key)) progress.set(key, projectGoalProgress(state, context.learnerId, origin));
    return progress.get(key)!;
  };
  const seenGoals = new Set(ownProgress.filter(goal => goal.seen).map(goal => goal.goalId));
  const applying = lesson === "transfer" || lesson === "communicate";
  const newGoals = !applying ? level?.newGoalIds.filter(goalId => !seenGoals.has(goalId)) ?? [] : [];
  const reviewGoalIds = [...(level?.reviewGoalIds ?? []), ...(!applying ? level?.newGoalIds.filter(goalId => seenGoals.has(goalId)) ?? [] : [])];
  // Existing packages retain their audited lower/upper budgets. Frozen sessions
  // are never rescheduled; only a newly started round uses this shorter policy.
  const requiredCoverage = applying ? level!.newGoalIds.length * (lesson === "communicate" ? 2 : 1) + reviewGoalIds.length :
    newGoals.reduce((sum, id) => sum + (pkg.goals.find(goal => goal.id === id)!.requiresRecall ? 2 : 1), reviewGoalIds.length);
  const targetCount = Math.min(pkg.rules.questionCount, Math.max(pkg.rules.minQuestionCount, requiredCoverage, newGoals.length * 3 + reviewGoalIds.length));
  const currentGoals = level ? [...level.newGoalIds, ...level.reviewGoalIds] : [...seenGoals];
  const independent = (origin: PassagePackage, question: PassageQuestion) =>
    origin.goals.find(goal => goal.id === question.goalId)!.requiresRecall ? question.demand === "recall" : question.demand !== "supported";
  const key = (item: { courseId: string; revision: string; questionId: string }) => JSON.stringify([item.courseId, item.revision, item.questionId]);
  const lastPracticed = new Map<string, number>();
  state.attempts.forEach((attempt, index) => { if (attempt.learnerId === context.learnerId) lastPracticed.set(key(attempt.item), index); });
  // Preserve the required demand first, then rotate audited variants by this
  // child's practice history. Clock rollback cannot change this ordering.
  const preferQuestion = (origin: PassagePackage, a: PassageQuestion, b: PassageQuestion) =>
    Number(independent(origin, b)) - Number(independent(origin, a)) ||
    (lastPracticed.get(key({ courseId: origin.courseId, revision: origin.revision, questionId: a.id })) ?? -1) -
    (lastPracticed.get(key({ courseId: origin.courseId, revision: origin.revision, questionId: b.id })) ?? -1);
  const bank = shuffled(pkg.questions.filter(question => currentGoals.includes(question.goalId) && (!lesson || lessonQuestion(question, lesson))), random)
    .sort((a, b) => preferQuestion(pkg, a, b));
  const selected: SessionItem[] = [];
  const used = new Set<string>();
  const usedContent = new Set<string>();
  const reviewGoals = new Set<string>();
  let crossCourse = 0;
  const add = (origin: PassagePackage, question: PassageQuestion, reason: SelectionReason) => {
    const item = sessionItem(origin, question, reason, random);
    if (used.has(key(item)) || usedContent.has(questionFingerprint(question)) || selected.length >= targetCount) return false;
    if (origin.courseId !== pkg.courseId && crossCourse >= pkg.rules.maxCrossCourse) return false;
    selected.push(item); used.add(key(item)); usedContent.add(questionFingerprint(question));
    reviewGoals.add(referenceKey(origin.courseId, origin.revision, question.goalId));
    if (origin.courseId !== pkg.courseId) crossCourse++;
    return true;
  };
  if (applying) for (const goalId of level!.newGoalIds) {
    if (lesson === "communicate") {
      add(pkg, bank.find(question => question.goalId === goalId && question.kind === "listen-choice")!, "current");
      add(pkg, bank.find(question => question.goalId === goalId && question.kind === "speak")!, "current");
    } else add(pkg, bank.find(question => question.goalId === goalId && independent(pkg, question)) ?? bank.find(question => question.goalId === goalId)!, "current");
  }
  for (const goalId of newGoals) {
    add(pkg, bank.find(question => question.goalId === goalId && question.demand === "recognize")!, "current");
    if (pkg.goals.find(goal => goal.id === goalId)!.requiresRecall)
      add(pkg, bank.find(question => question.goalId === goalId && question.demand === "recall")!, "current");
  }
  for (const goalId of reviewGoalIds) add(pkg, bank.find(question => question.goalId === goalId && independent(pkg, question))
    ?? bank.find(question => question.goalId === goalId)!, "current");

  // Prefer a different way of expressing a new goal before more recognition
  // variants. It keeps a short round varied without dropping recall coverage.
  for (const goalId of newGoals) {
    const supported = bank.find(question => question.goalId === goalId && question.demand === "supported");
    if (supported) add(pkg, supported, "current");
  }

  const currentQuota = Math.max(selected.length, targetCount - pkg.rules.dueCount - pkg.rules.weakCount);
  for (const question of bank) {
    if (selected.length >= currentQuota) break;
    add(pkg, question, "current");
  }
  const now = selectionTime(state, context);
  const reviews = state.publications.flatMap(publication => {
    const access = context.courses.find(course => course.courseId === publication.courseId);
    if (!access?.available) return [];
    const origin = packageFor(state, publication.courseId, publication.revision);
    if (!access.audioReady && makePassageAudioManifest(origin).assets.length) return [];
    return progressFor(origin).filter(goal => goal.seen &&
      !(origin.courseId === pkg.courseId && newGoals.includes(goal.goalId))).map(goal => ({ pkg: origin, progress: goal }));
  });
  const takeReviews = (reason: "due" | "weak", count: number) => {
    const pool = reviews.filter(({ progress }) => reason === "due" ? !!progress.dueAt && Date.parse(progress.dueAt) <= now : progress.weak)
      .sort((a, b) => Number(b.progress.weak) - Number(a.progress.weak) || Date.parse(a.progress.dueAt!) - Date.parse(b.progress.dueAt!) ||
        (referenceKey(a.pkg.courseId, a.pkg.revision, a.progress.goalId) < referenceKey(b.pkg.courseId, b.pkg.revision, b.progress.goalId) ? -1 : 1));
    let added = 0;
    for (const entry of pool) {
      if (added >= count) break;
      const goalKey = referenceKey(entry.pkg.courseId, entry.pkg.revision, entry.progress.goalId);
      if (reviewGoals.has(goalKey)) continue;
      const question = shuffled(entry.pkg.questions.filter(question => question.kind !== "speak" && question.goalId === entry.progress.goalId &&
        (entry.pkg.courseId !== pkg.courseId || !lesson || lessonQuestion(question, lesson))), random)
        .sort((a, b) => preferQuestion(entry.pkg, a, b))
        .find(question => !used.has(key({ courseId: entry.pkg.courseId, revision: entry.pkg.revision, questionId: question.id })) && !usedContent.has(questionFingerprint(question)));
      if (question && add(entry.pkg, question, reason)) { reviewGoals.add(goalKey); added++; }
    }
  };
  takeReviews("due", pkg.rules.dueCount); takeReviews("weak", pkg.rules.weakCount);
  const selectedKinds = new Set(selected.filter(item => item.courseId === pkg.courseId).map(item => {
    const question = pkg.questions.find(question => question.id === item.questionId)!;
    return `${question.goalId}:${question.kind}`;
  }));
  const varietyBank = [...bank].sort((a, b) => Number(selectedKinds.has(`${a.goalId}:${a.kind}`)) - Number(selectedKinds.has(`${b.goalId}:${b.kind}`)));
  for (const question of varietyBank) add(pkg, question, "current");
  requireValid(selected.length >= pkg.rules.minQuestionCount, "可用题目不足，请家长补充并审核内容。");

  // Introduce new goals through meaning; let seen goals answer independently
  // before feedback or supported variants expose that goal's answer.
  const ordered: SessionItem[] = [];
  const introduced = new Set<string>();
  const scaffolded = new Set<string>();
  const supportedGoals = new Set(selected.filter(item => item.courseId === pkg.courseId && questionForItem(item).demand === "supported").map(item => questionForItem(item).goalId));
  const tested = new Set<string>();
  const independentGoals = new Set(selected.filter(item => {
    const origin = packageFor(state, item.courseId, item.revision), question = questionForItem(item);
    return independent(origin, question) && progressFor(origin).some(goal => goal.goalId === question.goalId && goal.seen) &&
      !(item.courseId === pkg.courseId && newGoals.includes(question.goalId));
  }).map(item => referenceKey(item.courseId, item.revision, questionForItem(item).goalId)));
  const firstIndependent = new Map<string, string>();
  for (const item of selected) {
    const origin = packageFor(state, item.courseId, item.revision), question = questionForItem(item);
    const goal = referenceKey(item.courseId, item.revision, question.goalId);
    if (independentGoals.has(goal) && independent(origin, question) && !firstIndependent.has(goal)) firstIndependent.set(goal, question.id);
  }
  function questionForItem(item: SessionItem) { return packageFor(state, item.courseId, item.revision).questions.find(question => question.id === item.questionId)!; }
  const remaining = shuffled(selected, random);
  while (remaining.length) {
    const eligible = (item: SessionItem) => {
      const question = questionForItem(item);
      const goal = referenceKey(item.courseId, item.revision, question.goalId);
      if (independentGoals.has(goal) && !tested.has(goal) && firstIndependent.get(goal) !== question.id) return false;
      if (item.courseId !== pkg.courseId || !newGoals.includes(question.goalId)) return true;
      if (question.demand === "recognize") return true;
      return introduced.has(question.goalId) && (question.demand !== "recall" || !supportedGoals.has(question.goalId) || scaffolded.has(question.goalId));
    };
    const last = ordered[ordered.length - 1];
    const goalKey = (item: SessionItem) => {
      const question = packageFor(state, item.courseId, item.revision).questions.find(question => question.id === item.questionId)!;
      return referenceKey(item.courseId, item.revision, question.goalId);
    };
    let index = remaining.findIndex(item => eligible(item) && (!last || goalKey(item) !== goalKey(last)));
    if (index < 0) index = remaining.findIndex(eligible);
    requireValid(index >= 0, "新目标缺少前置理解题。");
    const item = remaining.splice(index, 1)[0]!;
    ordered.push(item);
    tested.add(goalKey(item));
    if (item.courseId === pkg.courseId) {
      const question = questionForItem(item);
      if (question.demand === "recognize") introduced.add(question.goalId);
      if (question.demand === "supported") scaffolded.add(question.goalId);
    }
  }
  return ordered;
}
