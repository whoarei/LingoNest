import type { SnapshotCodec } from "../contracts";
import { makePassageAudioManifest, validatePackage } from "./authoring";
import { gradeQuestion, questionFingerprint, validateResponse } from "./grading";
import type { PassageSession, PassageState } from "./model";
import { packageFor, questionFor, referenceKey } from "./references";
import { array, id, ids, learnerIdentity, record, requireValid, time, uniqueRecords } from "./validation";

export const emptyPassageState = (): PassageState => ({ formatVersion: 1, packages: [], publications: [],
  sessions: [], attempts: [], completions: [], lastObservedAt: null });

export function validatePassageState(value: unknown): asserts value is PassageState {
  requireValid(record(value) && value.formatVersion === 1, "不支持的学习状态版本，已有数据保留。");
  requireValid(array(value.packages, 1000) && array(value.publications, 300) && array(value.completions, 10000) &&
    (value.lastObservedAt === null || time(value.lastObservedAt)), "学习快照格式无效。");
  value.packages.forEach(validatePackage);
  const state = value as unknown as PassageState;
  if (value.candidates !== undefined) {
    requireValid(array(value.candidates, 1000), "候选题库列表无效。");
    const keys = new Set<string>();
    for (const candidate of state.candidates!) {
      requireValid(record(candidate), "候选审核格式无效。");
      validatePackage(candidate.package);
      const key = JSON.stringify([candidate.package.courseId, candidate.package.revision]);
      requireValid(!keys.has(key) && typeof candidate.sourceConfirmed === "boolean" && ids(candidate.reviewedQuestionIds) &&
        candidate.reviewedQuestionIds.every(id => candidate.package.questions.some(question => question.id === id)), "候选审核引用无效或重复。");
      keys.add(key);
      requireValid(candidate.returnedQuestionIds === undefined || ids(candidate.returnedQuestionIds) && candidate.returnedQuestionIds.every(id =>
        candidate.package.questions.some(question => question.id === id) && !candidate.reviewedQuestionIds.includes(id)), "退回修改的题目引用无效。");
      const published = state.packages.find(pkg => pkg.courseId === candidate.package.courseId && pkg.revision === candidate.package.revision);
      requireValid(!published || JSON.stringify(published) === JSON.stringify(candidate.package), "候选与已发布内容冲突。");
      requireValid([...state.packages, ...state.candidates!.map(item => item.package)].filter(pkg => pkg.courseId === candidate.package.courseId)
        .every(pkg => pkg.modeInstanceId === candidate.package.modeInstanceId), "候选课程模式实例冲突。");
    }
  }
  requireValid(new Set(state.packages.map(pkg => JSON.stringify([pkg.courseId, pkg.revision]))).size === state.packages.length &&
    state.packages.every(pkg => state.packages.filter(other => other.courseId === pkg.courseId).every(other => other.modeInstanceId === pkg.modeInstanceId)), "课程包身份重复或冲突。");
  requireValid(state.publications.every(publication => record(publication) && id(publication.courseId) && id(publication.revision) &&
    time(publication.reviewedAt) && ids(publication.audioAssetIds, 2000)) && ids(state.publications.map(item => item.courseId), 300), "发布记录无效或重复。");
  for (const publication of state.publications) {
    const pkg = packageFor(state, publication.courseId, publication.revision);
    requireValid(makePassageAudioManifest(pkg).assets.every(asset => publication.audioAssetIds.includes(asset.id)), "发布记录缺少必需资源。");
  }
  uniqueRecords(value.sessions, 10000); uniqueRecords(value.attempts, 100000);
  const activeScopes = new Set<string>();
  for (const session of state.sessions) {
    validateSession(state, session);
    if (session.helpRequests !== undefined) {
      requireValid(array(session.helpRequests, 1000) && session.helpRequests.every(request => record(request) && (request.afterAnswer === undefined || typeof request.afterAnswer === "boolean") &&
        ["source", "hint"].includes(request.kind) && session.queue.some(item => item.courseId === request.courseId && item.revision === request.revision && item.questionId === request.questionId)) &&
        new Set(session.helpRequests.map(request => JSON.stringify([request.courseId, request.revision, request.questionId, request.kind]))).size === session.helpRequests.length, "主动查看记录无效或重复。");
    }
    if (session.status === "active") {
      const scope = JSON.stringify([session.learnerId, session.courseId]);
      requireValid(!activeScopes.has(scope), "同一孩子课程存在多个活跃会话。"); activeScopes.add(scope);
      requireValid(state.publications.some(item => item.courseId === session.courseId && item.revision === session.revision) &&
        session.queue.every(item => state.publications.some(publication => publication.courseId === item.courseId && publication.revision === item.revision)), "活跃会话引用了过期发布版本。");
    }
  }
  const positions = new Set<string>();
  for (const attempt of state.attempts) {
    requireValid(id(attempt.sessionId) && learnerIdentity(attempt.learnerId) && Number.isInteger(attempt.index) && attempt.index >= 0 &&
      record(attempt.item) && time(attempt.at) && attempt.gradingVersion === "1" && typeof attempt.correct === "boolean" && typeof attempt.assisted === "boolean" &&
      typeof attempt.evidenceEligible === "boolean" && typeof attempt.clockTrusted === "boolean", "作答事实格式无效。");
    const session = state.sessions.find(item => item.id === attempt.sessionId);
    requireValid(session && session.learnerId === attempt.learnerId && JSON.stringify(session.queue[attempt.index]) === JSON.stringify(attempt.item), "作答与会话题序不一致。");
    const position = JSON.stringify([session.id, attempt.index]);
    requireValid(!positions.has(position), "同一会话位置重复提交。"); positions.add(position);
    validateResponse(attempt.response);
    const question = questionFor(state, attempt.item);
    const goal = packageFor(state, attempt.item.courseId, attempt.item.revision).goals.find(goal => goal.id === question.goalId)!;
    requireValid(gradeQuestion(question, attempt.response) === attempt.correct && (!attempt.evidenceEligible ||
      attempt.correct && attempt.clockTrusted && !attempt.assisted && !session.baseline && attempt.item.reason !== "repair" && question.demand !== "supported" &&
      (!goal.requiresRecall || question.demand === "recall")), "作答评价与原题或辅助条件不一致。");
  }
  for (const session of state.sessions) {
    const attempts = state.attempts.filter(attempt => attempt.sessionId === session.id);
    requireValid(attempts.length === session.index + (session.feedbackAttemptId === null ? 0 : 1) &&
      attempts.every(attempt => attempt.index < session.index || attempt.index === session.index && attempt.id === session.feedbackAttemptId), "会话位置与提交记录不一致。");
    const feedback = session.feedbackAttemptId === null ? null : attempts.find(attempt => attempt.id === session.feedbackAttemptId);
    requireValid(session.feedbackAttemptId === null || feedback && JSON.stringify(feedback.response) === JSON.stringify(session.input), "反馈或未提交输入不一致。");
  }
  const completionKeys = new Set<string>();
  for (const completion of state.completions) {
    requireValid(record(completion) && learnerIdentity(completion.learnerId) && id(completion.courseId) && id(completion.revision) && id(completion.levelId) && id(completion.sessionId), "路径记录格式无效。");
    const session = state.sessions.find(session => session.id === completion.sessionId);
    requireValid(session && session.status === "completed" && session.kind === "path" && session.levelId === completion.levelId &&
      session.learnerId === completion.learnerId && session.courseId === completion.courseId && session.revision === completion.revision, "路径记录与完成会话不一致。");
    const key = JSON.stringify([completion.learnerId, completion.courseId, completion.revision, completion.levelId]);
    requireValid(!completionKeys.has(key), "路径记录重复。"); completionKeys.add(key);
    const levels = packageFor(state, completion.courseId, completion.revision).levels;
    requireValid(levels.slice(0, levels.findIndex(level => level.id === completion.levelId)).every(level =>
      state.completions.some(item => item.learnerId === completion.learnerId && item.courseId === completion.courseId && item.revision === completion.revision && item.levelId === level.id)), "路径跳过了前序关卡。");
  }
  requireValid(state.sessions.filter(session => session.kind === "path" && session.status === "completed")
    .every(session => state.completions.some(item => item.sessionId === session.id)), "完成会话缺少路径记录。");
}
function validateSession(state: PassageState, session: PassageSession) {
  requireValid(learnerIdentity(session.learnerId) && id(session.courseId) && id(session.revision) && ["path", "replay", "practice"].includes(session.kind) &&
    ["active", "completed", "retired"].includes(session.status) && time(session.startedAt) && typeof session.baseline === "boolean" &&
    Number.isSafeInteger(session.seed) && session.seed >= 0 && session.seed <= 0xFFFFFFFF && ["1", "2"].includes(session.schedulerVersion), "会话格式或版本无效。");
  const pkg = packageFor(state, session.courseId, session.revision);
  const purgedBase = session.purgedBaseCount ?? 0, purgedCount = session.purgedQuestionCount ?? 0;
  requireValid(Number.isInteger(purgedBase) && purgedBase >= 0 && purgedBase <= pkg.rules.maxCrossCourse &&
    Number.isInteger(purgedCount) && purgedCount >= purgedBase && purgedCount <= purgedBase + pkg.rules.maxRepairs &&
    (session.purgedCourseIds === undefined ? purgedCount === 0 : ids(session.purgedCourseIds, 10) && session.purgedCourseIds.length > 0 &&
      !session.purgedCourseIds.includes(session.courseId) && purgedCount > 0 && session.status !== "active"), "删除后的历史题序无效。");
  requireValid(session.kind === "practice" ? session.levelId === null : pkg.levels.some(level => level.id === session.levelId), "会话关卡不存在。");
  requireValid(array(session.queue, pkg.rules.questionCount + pkg.rules.maxRepairs) && Number.isInteger(session.baseCount) &&
    session.baseCount >= 0 && session.baseCount + purgedBase >= pkg.rules.minQuestionCount && session.baseCount + purgedBase <= pkg.rules.questionCount && session.queue.length >= session.baseCount &&
    session.queue.length + purgedCount - session.baseCount - purgedBase <= pkg.rules.maxRepairs && Number.isInteger(session.index) && session.index >= 0 &&
    (session.status === "completed" ? session.index === session.queue.length : session.status === "retired" ? session.index <= session.queue.length : session.index < session.queue.length) &&
    (session.feedbackAttemptId === null || id(session.feedbackAttemptId)) &&
    (session.status !== "completed" || session.feedbackAttemptId === null), "会话题量或位置无效。");
  const questionKeys = new Set<string>();
  const questionContent = new Set<string>();
  for (const [index, item] of session.queue.entries()) {
    requireValid(record(item) && id(item.courseId) && id(item.revision) && id(item.questionId) &&
      ["current", "due", "weak", "repair"].includes(item.reason) && ids(item.displayIds, 60) && !session.purgedCourseIds?.includes(item.courseId), "题序格式无效。");
    const question = questionFor(state, item);
    const expectedIds = question.kind === "cloze" ? [] : (question.kind === "order" ? question.tokens : question.options).map(option => option.id);
    requireValid(item.displayIds.length === expectedIds.length && item.displayIds.every(id => expectedIds.includes(id)) &&
      (index < session.baseCount ? item.reason !== "repair" : item.reason === "repair"), "题序选项或补练位置无效。");
    const key = JSON.stringify([item.courseId, item.revision, item.questionId]);
    const fingerprint = questionFingerprint(question);
    requireValid(!questionKeys.has(key) && !questionContent.has(fingerprint), "会话重复同一道题。");
    questionKeys.add(key); questionContent.add(fingerprint);
  }
  requireValid(session.queue.slice(0, session.baseCount).filter(item => item.courseId !== session.courseId).length <= pkg.rules.maxCrossCourse, "跨课题量超过预算。");
  validateResponse(session.input);
  if (session.index < session.queue.length) gradeQuestion(questionFor(state, session.queue[session.index]!), session.input);
  requireValid(array(session.assistedGoals, 160), "辅助记录无效。");
  const assistedKeys = new Set<string>();
  for (const ref of session.assistedGoals) {
    requireValid(record(ref) && id(ref.courseId) && id(ref.revision) && id(ref.goalId) && session.queue.some(item => item.courseId === ref.courseId &&
      item.revision === ref.revision && questionFor(state, item).goalId === ref.goalId), "辅助记录引用无效。");
    const key = referenceKey(ref.courseId, ref.revision, ref.goalId);
    requireValid(!assistedKeys.has(key), "辅助记录重复。"); assistedKeys.add(key);
  }
}
export function decodePassageState(payload: string): PassageState {
  requireValid(typeof payload === "string" && payload.length <= 10 * 1024 * 1024, "学习快照过大。");
  const value: unknown = JSON.parse(payload);
  validatePassageState(value);
  return value;
}
export const passagePathStateCodec: SnapshotCodec<PassageState> = {
  storageKey: "lingonest.passage-path.v2", empty: emptyPassageState, decode: decodePassageState,
};
