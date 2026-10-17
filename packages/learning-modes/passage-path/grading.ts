import type { PassageQuestion, PassageResponse } from "./model";
import { array, ids, record, requireValid } from "./validation";

/** Deliberately narrow normalization: never remove negation or internal punctuation. */
export const normalizeAnswer = (value: string) => value.normalize("NFC").trim()
  .replace(/[‘’]/g, "'").replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/** IDs and option ordering do not turn an identical item into a new question. */
export function questionFingerprint(question: PassageQuestion): string {
  const base = [question.kind, normalizeAnswer(question.prompt), question.audioText === null ? null : normalizeAnswer(question.audioText)];
  if (question.kind === "cloze") return JSON.stringify([...base, question.answers.map(normalizeAnswer).sort()]);
  if (question.kind === "order") return JSON.stringify([...base, question.correctTokenIds.map(id => normalizeAnswer(question.tokens.find(token => token.id === id)!.text))]);
  return JSON.stringify([...base, question.options.map(option => normalizeAnswer(option.text)).sort(),
    normalizeAnswer(question.options.find(option => option.id === question.correctOptionId)!.text)]);
}

export function validateResponse(value: unknown): asserts value is PassageResponse {
  requireValid(record(value) && typeof value.text === "string" && value.text.length <= 2000 &&
    ids(value.selectedIds, 60), "作答格式无效。");
}
export function gradeQuestion(question: PassageQuestion, response: PassageResponse): boolean {
  validateResponse(response);
  if (question.kind === "cloze") {
    requireValid(!response.selectedIds.length, "填空题不能提交选项。");
    return question.answers.some(answer => normalizeAnswer(answer) === normalizeAnswer(response.text));
  }
  requireValid(!response.text, "选项或组句题不能提交文本。");
  const allowed = question.kind === "order" ? question.tokens : question.options;
  requireValid(array(allowed) && response.selectedIds.every(selected => allowed.some(item => item.id === selected)), "选项不属于当前题目。");
  if (question.kind === "order")
    return JSON.stringify(response.selectedIds) === JSON.stringify(question.correctTokenIds);
  return response.selectedIds.length === 1 && response.selectedIds[0] === question.correctOptionId;
}
