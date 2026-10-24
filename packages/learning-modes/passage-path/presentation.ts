import type { PassageAttempt, PassageQuestion, PassageResponse, PassageState } from "./model";
import { questionFor, packageFor } from "./references";
import type { ModeRecord } from "../contracts";
import { sessionLessonLabel } from "./curriculum";

export function answerText(question: PassageQuestion) {
  if (question.kind === "speak") return question.sampleAnswer;
  if (question.kind === "cloze") return question.answers.join(" / ");
  if (question.kind === "order") return question.correctTokenIds.map(id => question.tokens.find(token => token.id === id)!.text).join(" ");
  return question.options.find(option => option.id === question.correctOptionId)!.text;
}
export function responseText(question: PassageQuestion, response: PassageResponse) {
  if (question.kind === "speak") return response.oral?.selfRating === "ready" ? "已录音并完整回听 · 我能说清楚" : "已录音并完整回听 · 还想再练";
  if (question.kind === "cloze") return response.text;
  const choices = question.kind === "order" ? question.tokens : question.options;
  return response.selectedIds.map(id => choices.find(choice => choice.id === id)?.text ?? "").join(" ");
}
export function attemptRecord(state: PassageState, attempt: PassageAttempt): ModeRecord {
  const question = questionFor(state, attempt.item), pkg = packageFor(state, attempt.item.courseId, attempt.item.revision);
  const session = state.sessions.find(session => session.id === attempt.sessionId)!;
  const goal = pkg.goals.find(goal => goal.id === question.goalId)!;
  const requests = session.helpRequests?.filter(request => request.courseId === pkg.courseId && request.revision === pkg.revision && request.questionId === question.id);
  const context = attempt.item.reason === "repair" ? "补练" : sessionLessonLabel(packageFor(state, session.courseId, session.revision), session);
  const before = requests?.filter(request => request.afterAnswer === false);
  const after = requests?.filter(request => request.afterAnswer === true);
  const unknown = requests?.filter(request => request.afterAnswer === undefined);
  const kinds = (items: NonNullable<typeof requests>) => items.map(request => ({ source: "原文", hint: "提示", sample: "示范" })[request.kind]).join("、");
  const support = (before?.length ? `提交前主动查看${kinds(before)}`
    : attempt.assisted ? "本轮已接触相关原文或参考答案，作为巩固练习" : "本题提交前未使用辅助")
    + (after?.length ? `；提交后主动查看${kinds(after)}` : "")
    + (unknown?.length ? `；主动查看${kinds(unknown)}（旧记录未区分提交前后）` : "");
  return { id: attempt.id, courseId: pkg.courseId, at: attempt.at, title: question.prompt,
    outcome: attempt.correct === null ? "口语练习已记录" : attempt.correct ? "答对了" : "需要再练", summary: `${context} · ${goal.title}`,
    details: [
      { label: "我的答案", value: responseText(question, attempt.response) },
      { label: "参考答案", value: answerText(question) },
      { label: "说明", value: question.explanation },
      { label: "原文依据", value: question.sourceTurnIds.map(id => pkg.source.turns.find(turn => turn.id === id)!.text).join("\n") },
      { label: "作答条件", value: support + (session.helpRequests === undefined ? "；旧版未单独记录主动查看操作" : "") },
      ...(question.context ? [{ label: "新情境", value: question.context.text }] : []),
      ...(question.kind === "speak" ? [{ label: "口语说明", value: "录音、回听与自评表示完成练习，不表示发音或表达已经判对。" }] : []),
    ] };
}
