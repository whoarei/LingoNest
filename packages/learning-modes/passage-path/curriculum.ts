import type { PassageLesson, PassageLevel, PassagePackage, PassageQuestion, PassageSession, PassageState } from "./model";

export const passageLessons: readonly PassageLesson[] = ["discover", "transfer", "communicate"];
export const lessonTitle = (lesson?: PassageLesson) => lesson ? ({ discover: "初识表达", transfer: "换情境用", communicate: "听说应答" })[lesson] : "短课练习";
export const hasCurriculum = (pkg: PassagePackage) => pkg.rules.version === "3";
export function lessonQuestion(question: PassageQuestion, lesson: PassageLesson) {
  if (lesson === "communicate") return question.kind === "listen-choice" || question.kind === "speak";
  return question.kind !== "speak" && (lesson === "transfer" ? question.context?.kind === "transfer" : !question.context);
}
export function completedLessons(state: PassageState, learnerId: string, pkg: PassagePackage, levelId: string): PassageLesson[] {
  return passageLessons.filter(lesson => state.sessions.some(session => session.learnerId === learnerId && session.courseId === pkg.courseId &&
    session.revision === pkg.revision && session.levelId === levelId && session.lesson === lesson && session.kind === "path" && session.status === "completed"));
}
export function nextLesson(state: PassageState, learnerId: string, pkg: PassagePackage, level: PassageLevel): PassageLesson {
  const done = completedLessons(state, learnerId, pkg, level.id);
  return passageLessons.find(lesson => !done.includes(lesson)) ?? "communicate";
}
export function sessionLessonLabel(pkg: PassagePackage, session: PassageSession) {
  const level = pkg.levels.find(level => level.id === session.levelId);
  return level ? `${session.kind === "replay" ? "重练 · " : ""}第 ${pkg.levels.indexOf(level) + 1} 关 · ${level.title}${session.lesson ? " · " + lessonTitle(session.lesson) : ""}` : "本课复习";
}
