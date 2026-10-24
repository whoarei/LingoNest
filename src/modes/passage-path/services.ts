import type { InjectionKey } from "vue";
import type { PassageReview, PassageState, RuntimeContext } from "../../../packages/learning-modes/passage-path/model";
import type { CatalogSelection, MaterialCourse } from "../../../packages/learning-modes/catalog";
import { makePassageAudioManifest } from "../../../packages/learning-modes/passage-path/authoring";
import { removePassageCourse, removePassageLearner } from "../../../packages/learning-modes/passage-path/deletion";
import { PassageStore } from "../../../packages/learning-modes/passage-path/store";
import type { MutationQueue, SharedSnapshot } from "../../platform/shared-snapshot";
import type { DeletionParticipant, OwnedResource } from "../../platform/deletions";
import { publishPassagePackage } from "../../../packages/learning-modes/passage-path/runtime";
import { copy, requireValid } from "../../../packages/learning-modes/passage-path/validation";
import { passageSourceFromMaterial } from "./material";

function resources(state: PassageState, courseId?: string, learnerId?: string): OwnedResource[] {
  const recordings = state.sessions.filter(session => (courseId === undefined || session.courseId === courseId) && (learnerId === undefined || session.learnerId === learnerId))
    .flatMap(session => session.recordingPaths ?? []);
  return [...recordings.map(path => ({ kind: "recording" as const, path })), ...[...state.packages, ...(state.candidates ?? []).map(item => item.package)].filter(pkg => learnerId === undefined && (courseId === undefined || pkg.courseId === courseId)).flatMap(pkg => [
    ...(pkg.source.images ?? []).filter(image => image.path.startsWith("course-images/")).map(image => ({ kind: "image" as const, path: image.path })),
    ...(/^user\.[a-f0-9]{32}$/.test(pkg.courseId) ? [{ kind: "audio" as const, course: makePassageAudioManifest(pkg) }] : []),
  ])];
}
export function passageDeletionParticipant(state: SharedSnapshot<PassageState>): DeletionParticipant {
  return {
    id: "passage-path",
    async prepare(target) { const current = await state.refresh(); return target.kind === "course" ? resources(current, target.id) : resources(current, undefined, target.id); },
    async remove(target) { await state.update(value => target.kind === "course" ? removePassageCourse(value, target.id) : removePassageLearner(value, target.id)); },
    async retained() { return resources(await state.refresh()); },
  };
}
export function createPassageServices(state: SharedSnapshot<PassageState>, queue: MutationQueue,
  selection: () => CatalogSelection, readMaterial: (id: string) => Promise<MaterialCourse>, refreshCatalog: () => Promise<void>) {
  async function assertSource(review: PassageReview, current: () => boolean) {
    const material = await readMaterial(review.package.courseId);
    requireValid(current(), "操作已离开当前页面，结果已忽略。");
    requireValid(JSON.stringify(review.package.source) === JSON.stringify(passageSourceFromMaterial(material)), "教材已变化，请重新生成题库。");
  }
  return {
    state,
    async saveReview(review: PassageReview, current: () => boolean = () => true) {
      const captured = copy(review);
      await queue.run(async () => {
        await refreshCatalog(); await assertSource(captured, current);
        await state.update(before => {
          requireValid(current(), "操作已取消。");
          const next = copy(before); next.candidates ??= [];
          const index = next.candidates.findIndex(item => item.package.courseId === captured.package.courseId && item.package.revision === captured.package.revision);
          if (index < 0) next.candidates.push(captured);
          else {
            requireValid(JSON.stringify(next.candidates[index]!.package) === JSON.stringify(captured.package), "同一候选版本不能替换内容。");
            next.candidates[index] = captured;
          }
          return next;
        });
      });
    },
    async publishCandidate(courseId: string, revision: string, verifyAudio: () => Promise<boolean>, current: () => boolean = () => true) {
      await queue.run(async () => {
        await refreshCatalog();
        await state.update(async before => {
          const review = before.candidates?.find(item => item.package.courseId === courseId && item.package.revision === revision);
          requireValid(review && review.sourceConfirmed && review.package.questions.every(question => review.reviewedQuestionIds.includes(question.id)), "请确认原文并逐题审核整个候选题库。");
          await assertSource(review, current);
          requireValid(await verifyAudio(), "必需音频尚未就绪，请先生成完整课程音频。");
          requireValid(current(), "操作已取消。");
          return publishPassagePackage(before, review.package, { reviewedAt: new Date().toISOString(),
            audioAssetIds: makePassageAudioManifest(review.package).assets.map(asset => asset.id) });
        });
      });
    },
    createStore(getContext: () => RuntimeContext) {
      const boundContext = () => {
        const supplied = getContext(), catalog = selection();
        const courseId = catalog.learningCourseIds[catalog.activeLearnerId ?? ""] ?? catalog.defaultCourseId;
        if (supplied.learnerId !== catalog.activeLearnerId || supplied.courseId !== courseId) throw Error("共享档案或课程选择已变化，请重新进入学习。");
        return { ...supplied, courses: supplied.courses.map(course => ({ ...course, available: course.available && catalog.availableCourseIds.includes(course.courseId) })) };
      };
      return new PassageStore({
        load: () => queue.run(() => state.refresh()),
        save: value => queue.run(async () => { await state.update(() => value); }),
        current: () => state.snapshot(),
        update: change => queue.run(async () => {
          await refreshCatalog();
          return state.update(async before => {
            const next = change(before);
            for (const publication of next.publications) {
              if (before.publications.some(item => item.courseId === publication.courseId && item.revision === publication.revision)) continue;
              const material = await readMaterial(publication.courseId);
              const pkg = next.packages.find(pkg => pkg.courseId === publication.courseId && pkg.revision === publication.revision)!;
              if (JSON.stringify(pkg.source) !== JSON.stringify(passageSourceFromMaterial(material))) throw Error("生成所用教材已变化，请按最新已确认材料重新生成。");
            }
            boundContext();
            return next;
          });
        }),
      }, boundContext);
    },
  };
}
export type PassageServices = ReturnType<typeof createPassageServices>;
export const passageServicesKey: InjectionKey<PassageServices> = Symbol("passage-path-services");
