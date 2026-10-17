import type { PassagePackage, PassageState, SessionItem } from "./model";
import { requireValid } from "./validation";

export const referenceKey = (courseId: string, revision: string, goalId: string) => JSON.stringify([courseId, revision, goalId]);
export function packageFor(state: PassageState, courseId: string, revision: string): PassagePackage {
  const pkg = state.packages.find(item => item.courseId === courseId && item.revision === revision);
  requireValid(pkg, "找不到准确的课程包，原记录保留。");
  return pkg;
}
export function questionFor(state: PassageState, item: SessionItem) {
  const question = packageFor(state, item.courseId, item.revision).questions.find(question => question.id === item.questionId);
  requireValid(question, "会话题目引用已失效，不能继续。");
  return question;
}
