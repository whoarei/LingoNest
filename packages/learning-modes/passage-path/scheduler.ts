import type { PassagePackage, PassageQuestion, PassageState, RuntimeContext, SessionItem, SelectionReason } from "./model";
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
  const ids = question.kind === "cloze" ? [] : (question.kind === "order" ? question.tokens : question.options).map(item => item.id);
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
export function scheduleQuestions(state: PassageState, context: RuntimeContext, pkg: PassagePackage, levelId: string | null, seed: number): SessionItem[] {
  const random = randomFromSeed(seed);
  const level = levelId === null ? null : pkg.levels.find(item => item.id === levelId);
  requireValid(levelId === null || level, "关卡不存在。");
  const ownProgress = projectGoalProgress(state, context.learnerId, pkg);
  const newGoals = level?.newGoalIds ?? [];
  const currentGoals = level ? [...level.newGoalIds, ...level.reviewGoalIds] : ownProgress.filter(goal => goal.seen).map(goal => goal.goalId);
  const bank = shuffled(pkg.questions.filter(question => currentGoals.includes(question.goalId)), random);
  const selected: SessionItem[] = [];
  const used = new Set<string>();
  const usedContent = new Set<string>();
  const reviewGoals = new Set<string>();
  let crossCourse = 0;
  const key = (item: { courseId: string; revision: string; questionId: string }) => JSON.stringify([item.courseId, item.revision, item.questionId]);
  const add = (origin: PassagePackage, question: PassageQuestion, reason: SelectionReason) => {
    const item = sessionItem(origin, question, reason, random);
    if (used.has(key(item)) || usedContent.has(questionFingerprint(question)) || selected.length >= pkg.rules.questionCount) return false;
    if (origin.courseId !== pkg.courseId && crossCourse >= pkg.rules.maxCrossCourse) return false;
    selected.push(item); used.add(key(item)); usedContent.add(questionFingerprint(question));
    if (origin.courseId !== pkg.courseId) crossCourse++;
    return true;
  };
  for (const goalId of newGoals) {
    add(pkg, bank.find(question => question.goalId === goalId && question.demand === "recognize")!, "current");
    if (pkg.goals.find(goal => goal.id === goalId)!.requiresRecall)
      add(pkg, bank.find(question => question.goalId === goalId && question.demand === "recall")!, "current");
  }
  for (const goalId of level?.reviewGoalIds ?? []) add(pkg, bank.find(question => question.goalId === goalId)!, "current");

  // Preserve five current-goal tasks where possible, while leaving room for review.
  const currentQuota = Math.max(selected.length, pkg.rules.questionCount - pkg.rules.dueCount - pkg.rules.weakCount);
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
    return projectGoalProgress(state, context.learnerId, origin).filter(goal => goal.seen &&
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
      const question = shuffled(entry.pkg.questions.filter(question => question.goalId === entry.progress.goalId), random)
        .find(question => !used.has(key({ courseId: entry.pkg.courseId, revision: entry.pkg.revision, questionId: question.id })) && !usedContent.has(questionFingerprint(question)));
      if (question && add(entry.pkg, question, reason)) { reviewGoals.add(goalKey); added++; }
    }
  };
  takeReviews("due", pkg.rules.dueCount); takeReviews("weak", pkg.rules.weakCount);
  for (const question of bank) add(pkg, question, "current");
  requireValid(selected.length >= pkg.rules.minQuestionCount, "可用题目不足，请家长补充并审核内容。");

  // Only recognition for newly introduced goals is a prerequisite. Supported work follows it.
  const ordered: SessionItem[] = [];
  const introduced = new Set<string>();
  const remaining = shuffled(selected, random);
  while (remaining.length) {
    const eligible = (item: SessionItem) => {
      const question = packageFor(state, item.courseId, item.revision).questions.find(question => question.id === item.questionId)!;
      return item.courseId !== pkg.courseId || !newGoals.includes(question.goalId) || question.demand === "recognize" || introduced.has(question.goalId);
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
    if (item.courseId === pkg.courseId) introduced.add(pkg.questions.find(question => question.id === item.questionId)!.goalId);
  }
  return ordered;
}
