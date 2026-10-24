import type { MaterialCourse } from "../../../packages/learning-modes/catalog";
import { recordForMaterial } from "./services";
import type { ModeOverview } from "../../../packages/learning-modes/contracts";
import { LocalRepository } from "./repository";
import { projectLearning } from "../../../packages/learning-modes/seven-step/engine";
import { makeCourseAudioSpec } from "../../../packages/learning-modes/seven-step/audio";

export async function readOverview(learnerId: string | null, materials: readonly MaterialCourse[]): Promise<ModeOverview> {
  const state = await new LocalRepository().load();
  const courses = materials.map(material => recordForMaterial(material, state.courses.find(item => item.id === material.id)));
  const attempts = state.events.filter(event => event.type === "attempt" && event.attempt.learnerId === learnerId);
  const projections = new Map(learnerId ? courses.filter(course => course.package).map(course =>
    [course.id, projectLearning(state.events, course.package!.exercises, learnerId, new Date().toISOString())]) : []);
  return {
    canConfirm: true,
    resources: courses.flatMap(course => course.package ? [{ label: `七步学习 · ${course.status === "published" ? "已发布" : "学习草稿"}`, current: course.status === "published", manifest: makeCourseAudioSpec(course.package.course, course.package.exercises) }] : []),
    courses: courses.filter(course => !course.deletedAt).map(course => ({ courseId: course.id, status: course.status === "published" ? "ready" : course.status === "review" ? "review" : "draft" })),
    records: attempts.flatMap(event => {
      if (event.type !== "attempt") return [];
      const attempt = event.attempt;
      const owner = courses.find(course => course.package?.exercises.some(item => item.id === attempt.exerciseId));
      if (!owner) return [];
      const exercise = owner.package!.exercises.find(item => item.id === attempt.exerciseId)!;
      const grade = projections.get(owner.id)?.attempts.find(item => item.id === attempt.id)?.grade ?? attempt.grade;
      const options = exercise.kind === "order" ? exercise.tokens : exercise.options;
      const answer = exercise.kind === "oral" ? "已提交录音，请到口语确认中回听" : attempt.selectedIds.length
        ? attempt.selectedIds.map(id => options?.find(option => option.id === id)?.text ?? "").join(" ") : attempt.answer;
      const reference = exercise.referenceText || (exercise.kind === "choice" ? exercise.options?.filter(option => exercise.correctOptionIds?.includes(option.id)).map(option => option.text).join(" / ")
        : exercise.kind === "order" ? exercise.correctTokenIds?.map(id => exercise.tokens?.find(token => token.id === id)?.text).join(" ") : exercise.acceptedAnswers.join(" / ")) || "";
      return [{ id: attempt.id, courseId: owner.id, at: attempt.submittedAt, title: exercise.title,
        outcome: grade.status === "needs_review" ? "待家长确认" : grade.passed ? "本次通过" : "需要再练", summary: `${exercise.stageId} · ${attempt.hintLevel ? "使用过提示" : "独立练习"}`,
        details: [{ label: "题目", value: exercise.prompt }, { label: "我的答案", value: answer }, { label: "参考答案", value: reference },
          { label: "说明", value: grade.feedback }, { label: "作答条件", value: attempt.hintLevel ? "本次使用过提示或示范，作为练习记录" : "本次未使用提示" }] }];
    }),
    pendingCount: [...projections.values()].reduce((sum, projection) => sum + projection.attempts.filter(item => item.grade.status === "needs_review").length, 0),
  };
}
