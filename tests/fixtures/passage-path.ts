import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";
import { basicPassageRules, compilePassagePackage, createPassageSource, defaultPassageRules, makePassageAudioManifest } from "../../packages/learning-modes/passage-path/authoring";
import type { PassageDraft, PassagePackage, PassageQuestion, PassageResponse, PassageState, RuntimeContext } from "../../packages/learning-modes/passage-path/model";
import { questionFor } from "../../packages/learning-modes/passage-path/references";
import { publishPassagePackage, transitionPassage } from "../../packages/learning-modes/passage-path/runtime";
import { emptyPassageState } from "../../packages/learning-modes/passage-path/state";

// Hand-reviewed test candidates using two expressions from the existing textbook.
// They are deliberately not installed or shipped as a second production course.
export function fixtureSource(courseId = starterRecord.id) {
  return createPassageSource({ courseId, revision: "source-1", title: starterRecord.title, sourceText: starterRecord.sourceText });
}
export function fixtureDraft(): PassageDraft {
  const entries = [
    { id: "like", title: "表达爱好", expression: "I like playing basketball.", meaning: "我喜欢打篮球。", refs: ["turn-2"], blank: "I like playing ___.", answer: "basketball" },
    { id: "invite", title: "邀请加入", expression: "Will you join us?", meaning: "你愿意加入我们吗？", refs: ["turn-13", "turn-14"], blank: "Will you ___ us?", answer: "join" },
  ];
  const questions: PassageQuestion[] = entries.flatMap(entry => {
    const base = { goalId: `goal-${entry.id}`, explanation: entry.meaning, sourceTurnIds: entry.refs, audioText: null };
    return Array.from({ length: 12 }, (_, index): PassageQuestion => {
      const id = `question-${entry.id}-${index}`;
      if (index % 4 === 1) return { ...base, id, kind: "cloze", demand: "recall", prompt: index === 1 ? `补全表达：${entry.blank}` : index === 5 ? `用英语完成表达：${entry.meaning} ___` : `读语境再补全：${entry.meaning} ${entry.blank}`, answers: index === 5 ? [entry.expression] : [entry.answer] };
      if (index % 4 === 2) {
        const tokens = entry.expression.split(" ").map((text, i) => ({ id: `token-${i}`, text }));
        return { ...base, id, kind: "order", demand: "supported", prompt: `${index === 2 ? "组出表达" : index === 6 ? "按对话顺序重组这句话" : "看中文还原英语句子"}：${entry.meaning}`, tokens, correctTokenIds: tokens.map(token => token.id) };
      }
      return { ...base, id, kind: index === 4 ? "listen-choice" : index === 8 ? "dialogue-choice" : "choice", demand: "recognize",
        prompt: index === 4 ? "听音频，选择句意。" : `${index === 0 ? "理解表达" : index === 3 ? "选择这句话的意思" : index === 8 ? "理解对话中的这句应答" : index === 7 ? "这句话在表达什么" : "找出对应的中文解释"}：${entry.expression}`, audioText: index === 4 ? entry.expression : null,
        options: [{ id: "yes", text: entry.meaning }, { id: "no", text: "与这句话无关的意思。" }], correctOptionId: "yes" };
    });
  });
  return {
    chunks: entries.map(entry => ({ id: `chunk-${entry.id}`, title: entry.title, expression: entry.expression, meaning: entry.meaning, sourceTurnIds: entry.refs })),
    goals: entries.map(entry => ({ id: `goal-${entry.id}`, chunkId: `chunk-${entry.id}`, title: entry.title, skill: "expression", requiresRecall: true })),
    levels: [
      { id: "level-like", title: "说说运动爱好", newGoalIds: ["goal-like"], reviewGoalIds: [] },
      { id: "level-invite", title: "邀请朋友加入", newGoalIds: ["goal-invite"], reviewGoalIds: ["goal-like"] },
    ], questions,
  };
}
export function fixturePackage(courseId = "starter.unit1.lesson1", revision = "package-1", draft = fixtureDraft()): PassagePackage {
  return compilePassagePackage({ source: fixtureSource(courseId), draft, rules: basicPassageRules, modeInstanceId: "instance-1", revision, model: "reviewed-test-fixture", generatedAt: "2026-10-16T10:00:00.000Z" });
}
export function fixtureCurriculumDraft(): PassageDraft {
  const draft = fixtureDraft();
  draft.questions = draft.questions.map(question => {
    const index = Number(question.id.split("-").pop()), chunk = draft.chunks.find(chunk => chunk.id === draft.goals.find(goal => goal.id === question.goalId)!.chunkId)!;
    const context = { kind: "transfer" as const, text: question.goalId === "goal-like" ? "课外活动时，和新同学聊聊你喜欢的运动。" : "在乒乓球场上，请新队友加入你们。" };
    const base = { id: question.id, goalId: question.goalId, sourceTurnIds: question.sourceTurnIds, explanation: question.explanation };
    if (index === 7 || index === 11) return { ...base, kind: "speak", demand: "supported", prompt: index === 7 ? "请先独立说出这句表达，再回听自己的录音。" : "请对新同伴说一句合适的回应，再回听自己的录音。", sampleAnswer: chunk.expression,
      audioText: chunk.expression, criteria: ["表达了这次交流的意思", "声音清楚，句子说完整"], ...(index === 11 ? { context } : {}) };
    if (index === 3 && "options" in question) return { ...question, kind: "listen-choice", prompt: "听同伴的表达，选出他想说的意思。", audioText: chunk.expression };
    if ([5, 8, 9, 10].includes(index)) return { ...question, context };
    return question;
  });
  return draft;
}
export function fixtureCurriculumPackage(courseId = "starter.unit1.lesson1", revision = "curriculum-1") {
  return compilePassagePackage({ source: fixtureSource(courseId), draft: fixtureCurriculumDraft(), rules: defaultPassageRules, modeInstanceId: "instance-1", revision,
    model: "reviewed-curriculum-fixture", generatedAt: "2026-10-16T10:00:00.000Z" });
}
export function approve(state = emptyPassageState(), pkg = fixturePackage()) {
  return publishPassagePackage(state, pkg, { reviewedAt: "2026-10-16T10:01:00.000Z", audioAssetIds: makePassageAudioManifest(pkg).assets.map(asset => asset.id) });
}
export function context(courseId = "starter.unit1.lesson1", learnerId = "child-a", at = "2026-10-17T10:00:00.000Z"): RuntimeContext {
  return { activeModeId: "passage-path", learnerId, courseId, courses: [{ courseId, available: true, audioReady: true }], clock: { at, trusted: true } };
}
export function responseFor(state: PassageState, sessionId: string, correct = true): PassageResponse {
  const session = state.sessions.find(session => session.id === sessionId)!;
  const question = questionFor(state, session.queue[session.index]!);
  if (question.kind === "speak") return { text: "", selectedIds: [], oral: { recordingPath: `recordings/${session.learnerId}/${session.id.slice(0, 50).replace(/[^A-Za-z0-9_-]/g, "_")}-${session.index}.m4a`, listened: true, selfRating: correct ? "ready" : "again" } };
  if (question.kind === "cloze") return { text: correct ? question.answers[0]! : "wrong answer", selectedIds: [] };
  if (question.kind === "order") return { text: "", selectedIds: correct ? question.correctTokenIds : [] };
  return { text: "", selectedIds: [correct ? question.correctOptionId : question.options.find(item => item.id !== question.correctOptionId)!.id], ...(question.kind === "listen-choice" ? { audioPlayed: true as const } : {}) };
}
export function finishSession(state: PassageState, ctx: RuntimeContext, sessionId: string, correct = true): PassageState {
  let result = state;
  while (result.sessions.find(item => item.id === sessionId)!.status === "active") {
    const session = result.sessions.find(item => item.id === sessionId)!;
    if (!session.feedbackAttemptId) result = transitionPassage(result, ctx, { type: "submit", sessionId, index: session.index,
      attemptId: `attempt-${sessionId}-${session.index}`, response: responseFor(result, sessionId, correct) });
    result = transitionPassage(result, ctx, { type: "next", sessionId, index: session.index });
  }
  return result;
}
export function started(state = approve(), ctx = context(), sessionId = "session-1", seed = 7) {
  return transitionPassage(state, ctx, { type: "start", sessionId, seed });
}
