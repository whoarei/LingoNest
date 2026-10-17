import { makePassageAudioManifest, validatePackage } from "./authoring";
import { gradeQuestion, questionFingerprint, validateResponse } from "./grading";
import type { PassagePackage, PassageResponse, PassageSession, PassageState, Publication, RuntimeContext } from "./model";
import { packageFor, questionFor, referenceKey } from "./references";
import { randomFromSeed, scheduleQuestions, sessionItem, trustedClock } from "./scheduler";
import { copy, id, ids, learnerIdentity, requireValid, time } from "./validation";

export type PassageCommand =
  | { type: "start"; sessionId: string; seed: number; replayLevelId?: string }
  | { type: "input"; sessionId: string; index: number; response: PassageResponse }
  | { type: "assist"; sessionId: string; index: number }
  | { type: "submit"; sessionId: string; index: number; attemptId: string; response: PassageResponse }
  | { type: "next"; sessionId: string; index: number };

/** A candidate becomes available only after an explicit approval and resource check. */
export function publishPassagePackage(state: PassageState, pkg: PassagePackage, approval: Omit<Publication, "courseId" | "revision">): PassageState {
  validatePackage(pkg);
  requireValid(time(approval.reviewedAt) && ids(approval.audioAssetIds, 2000), "审核记录无效。");
  const required = makePassageAudioManifest(pkg).assets.map(asset => asset.id);
  requireValid(required.every(asset => approval.audioAssetIds.includes(asset)), "必需音频尚未准备完成，不能发布。");
  const previous = state.publications.find(item => item.courseId === pkg.courseId);
  const existing = state.packages.find(item => item.courseId === pkg.courseId && item.revision === pkg.revision);
  requireValid(!existing || JSON.stringify(existing) === JSON.stringify(pkg), "相同包修订不能替换内容。");
  requireValid(state.packages.filter(item => item.courseId === pkg.courseId).every(item => item.modeInstanceId === pkg.modeInstanceId), "课程模式实例身份不能变化。");
  if (previous?.revision === pkg.revision) return state;
  const next = copy(state);
  if (!existing) next.packages.push(copy(pkg));
  next.publications = next.publications.filter(item => item.courseId !== pkg.courseId);
  next.publications.push({ courseId: pkg.courseId, revision: pkg.revision, ...copy(approval) });
  for (const session of next.sessions) {
    if (session.status === "active" && (session.courseId === pkg.courseId || session.queue.some(item => item.courseId === pkg.courseId)))
      session.status = "retired";
  }
  return next;
}
function assertContext(state: PassageState, context: RuntimeContext, requireAudio = true) {
  requireValid(context.activeModeId === "passage-path", "当前全局模式不允许闯关学习。");
  requireValid(learnerIdentity(context.learnerId) && id(context.courseId) && time(context.clock.at) && typeof context.clock.trusted === "boolean" &&
    ids(context.courses.map(course => course.courseId)) && context.courses.every(course => typeof course.available === "boolean" && typeof course.audioReady === "boolean"), "学习上下文无效。");
  const publication = state.publications.find(item => item.courseId === context.courseId);
  requireValid(publication, "当前模式待家长生成并审核。");
  assertCourse(state, context, context.courseId, publication.revision, requireAudio);
  return packageFor(state, context.courseId, publication.revision);
}
function assertCourse(state: PassageState, context: RuntimeContext, courseId: string, revision: string, requireAudio = true) {
  const access = context.courses.find(course => course.courseId === courseId);
  requireValid(access?.available && state.publications.some(item => item.courseId === courseId && item.revision === revision), "课程已归档、删除或版本已变更，不能继续该会话。");
  requireValid(!requireAudio || access.audioReady || !makePassageAudioManifest(packageFor(state, courseId, revision)).assets.length, "课程音频需要家长修复，不能跳过练习。");
}
function getSession(state: PassageState, context: RuntimeContext, sessionId: string, requireAudio = true) {
  const session = state.sessions.find(session => session.id === sessionId);
  requireValid(session && session.learnerId === context.learnerId && session.courseId === context.courseId, "会话不属于当前孩子或课程。");
  assertCourse(state, context, session.courseId, session.revision, requireAudio);
  for (const item of session.queue) assertCourse(state, context, item.courseId, item.revision, requireAudio);
  return session;
}
function assistCurrent(state: PassageState, session: PassageSession) {
  const item = session.queue[session.index]!;
  const goalId = questionFor(state, item).goalId;
  if (!session.assistedGoals.some(goal => referenceKey(goal.courseId, goal.revision, goal.goalId) === referenceKey(item.courseId, item.revision, goalId)))
    session.assistedGoals.push({ courseId: item.courseId, revision: item.revision, goalId });
}
function observeClock(state: PassageState, context: RuntimeContext) {
  if (trustedClock(state, context)) state.lastObservedAt = context.clock.at;
}

/** Pure transitions: the caller commits the returned snapshot before presenting it. */
export function transitionPassage(state: PassageState, context: RuntimeContext, command: PassageCommand): PassageState {
  const pkg = assertContext(state, context, command.type !== "assist");
  if (command.type === "start") {
    const active = state.sessions.find(session => session.learnerId === context.learnerId && session.courseId === context.courseId && session.status === "active");
    if (active) { getSession(state, context, active.id); return state; }
    requireValid(id(command.sessionId) && !state.sessions.some(session => session.id === command.sessionId) &&
      Number.isSafeInteger(command.seed) && command.seed >= 0 && command.seed <= 0xFFFFFFFF, "会话标识或随机种子无效。");
    const completed = state.completions.filter(item => item.learnerId === context.learnerId && item.courseId === pkg.courseId && item.revision === pkg.revision);
    requireValid(command.replayLevelId === undefined || completed.some(item => item.levelId === command.replayLevelId), "只能重练已完成关卡。");
    const level = command.replayLevelId ? pkg.levels.find(level => level.id === command.replayLevelId) :
      pkg.levels.find(level => !completed.some(item => item.levelId === level.id));
    const queue = scheduleQuestions(state, context, pkg, level?.id ?? null, command.seed);
    const next = copy(state);
    next.sessions.push({ id: command.sessionId, learnerId: context.learnerId, courseId: pkg.courseId, revision: pkg.revision,
      levelId: level?.id ?? null, kind: command.replayLevelId ? "replay" : level ? "path" : "practice", status: "active",
      seed: command.seed, schedulerVersion: "1", startedAt: context.clock.at,
      baseline: !state.attempts.some(attempt => attempt.learnerId === context.learnerId && attempt.item.courseId === pkg.courseId && attempt.item.revision === pkg.revision),
      queue, baseCount: queue.length, index: 0, input: { text: "", selectedIds: [] }, assistedGoals: [], feedbackAttemptId: null });
    observeClock(next, context);
    return next;
  }
  const current = getSession(state, context, command.sessionId, command.type !== "assist");
  if (command.type === "submit") {
    validateResponse(command.response);
    requireValid(id(command.attemptId), "提交标识无效。");
    const duplicate = state.attempts.find(attempt => attempt.id === command.attemptId);
    if (duplicate) {
      requireValid(duplicate.sessionId === current.id && duplicate.index === command.index && duplicate.response.text === command.response.text &&
        JSON.stringify(duplicate.response.selectedIds) === JSON.stringify(command.response.selectedIds), "提交标识已用于其他作答。");
      return state;
    }
  }
  requireValid(Number.isInteger(command.index) && command.index >= 0, "题目位置无效。");
  if (command.type === "next" && command.index < current.index) return state;
  requireValid(current.status === "active" && current.index === command.index && current.index < current.queue.length, "会话或题目位置已变化。");
  const next = copy(state);
  const session = next.sessions.find(item => item.id === current.id)!;
  if (command.type === "next") {
    requireValid(session.feedbackAttemptId !== null, "请先提交当前题目。");
    session.index++;
    session.input = { text: "", selectedIds: [] };
    session.feedbackAttemptId = null;
    if (session.index === session.queue.length) {
      session.status = "completed";
      if (session.kind === "path" && !next.completions.some(item => item.learnerId === session.learnerId && item.courseId === session.courseId && item.revision === session.revision && item.levelId === session.levelId))
        next.completions.push({ learnerId: session.learnerId, courseId: session.courseId, revision: session.revision, levelId: session.levelId!, sessionId: session.id });
    }
  } else {
    requireValid(command.type === "assist" || session.feedbackAttemptId === null, "当前题目已提交，请继续下一题。");
    if (command.type === "assist") {
      // Viewing the original can expose any queued goal, including cross-course review.
      for (const item of session.queue) {
        const goalId = questionFor(next, item).goalId;
        if (!session.assistedGoals.some(goal => referenceKey(goal.courseId, goal.revision, goal.goalId) === referenceKey(item.courseId, item.revision, goalId)))
          session.assistedGoals.push({ courseId: item.courseId, revision: item.revision, goalId });
      }
    } else {
      validateResponse(command.response);
      const item = session.queue[session.index]!;
      const question = questionFor(next, item);
      // Validate draft input against the current question as well as its JSON shape.
      const correct = gradeQuestion(question, command.response);
      session.input = copy(command.response);
      if (command.type === "submit") {
        const origin = packageFor(next, item.courseId, item.revision);
        const goal = origin.goals.find(goal => goal.id === question.goalId)!;
        const assisted = item.reason === "repair" || session.assistedGoals.some(ref => referenceKey(ref.courseId, ref.revision, ref.goalId) === referenceKey(item.courseId, item.revision, goal.id));
        next.attempts.push({ id: command.attemptId, sessionId: session.id, index: session.index, learnerId: session.learnerId,
          item: copy(item), response: copy(command.response), correct, assisted, clockTrusted: trustedClock(state, context),
          evidenceEligible: correct && trustedClock(state, context) && !session.baseline && !assisted && question.demand !== "supported" && (!goal.requiresRecall || question.demand === "recall"),
          gradingVersion: "1", at: context.clock.at });
        session.feedbackAttemptId = command.attemptId;
        assistCurrent(next, session);
        if (!correct && session.queue.length - session.baseCount < pkg.rules.maxRepairs &&
          !session.queue.some(entry => entry.reason === "repair" && entry.courseId === item.courseId && entry.revision === item.revision && questionFor(next, entry).goalId === goal.id)) {
          const used = new Set(session.queue.filter(entry => entry.courseId === item.courseId && entry.revision === item.revision).map(entry => entry.questionId));
          const usedContent = new Set(session.queue.map(entry => questionFingerprint(questionFor(next, entry))));
          const repair = origin.questions.filter(candidate => candidate.goalId === goal.id && !used.has(candidate.id) && !usedContent.has(questionFingerprint(candidate)))
            .sort((a, b) => Number(b.demand === "recognize") - Number(a.demand === "recognize"))[0];
          if (repair) session.queue.push(sessionItem(origin, repair, "repair", randomFromSeed(session.seed ^ session.queue.length)));
        }
      }
    }
  }
  observeClock(next, context);
  return next;
}
