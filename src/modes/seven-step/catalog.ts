import type { CatalogPort, MaterialCourse, MaterialInput } from "../../../packages/learning-modes/catalog";
import type { LocalState } from "../../../packages/learning-modes/seven-step/state";
import { newCourse, starterRecord, validateCourseRecord, type CourseRecord } from "../../../packages/learning-modes/seven-step/authoring";
import { archiveCourse, restoreCourse } from "../../../packages/learning-modes/seven-step/deletion";
import { MutationQueue, SharedSnapshot } from "../../platform/shared-snapshot";
import type { DeletionCoordinator, DeletionTarget } from "../../platform/deletions";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const newIdentity = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
export function assertNotDeleted(deletions: DeletionCoordinator, target: DeletionTarget) {
  if (deletions.isBlocked(target)) throw Error("该对象正在或已经彻底删除，不能写入旧内容。");
}
export function saveSevenStepCourse(state: LocalState, record: CourseRecord, deletions: DeletionCoordinator) {
  validateCourseRecord(record); assertNotDeleted(deletions, { kind: "course", id: record.id });
  if (record.deletedAt || state.courses.some(item => item.id === record.id && item.deletedAt) || state.pendingCourseDeletions.some(job => job.record.id === record.id))
    throw Error("课程已删除，不能重新保存旧草稿。");
  const index = state.courses.findIndex(item => item.id === record.id);
  if (index >= 0 && state.courses[index]!.status === "published") {
    if (JSON.stringify(state.courses[index]) !== JSON.stringify(record)) throw Error("已启用课程保持原版本，请新建课程保存变更。");
    return;
  }
  if (index < 0 && state.courses.filter(item => !item.deletedAt).length >= 30) throw Error("此设备最多保存 30 门自建课程。");
  if (index < 0 && state.courses.length >= 300) throw Error("本机课程保存数量已达上限。");
  if (index < 0) state.courses.push(clone(record)); else state.courses[index] = clone(record);
}
export async function materialView(record: CourseRecord): Promise<MaterialCourse> {
  const material = { sourceText: record.sourceText, images: record.images, supplementImages: record.vocabularyImages };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(material)));
  const sourceRevision = `source.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  return { id: record.id, title: record.title, subtitle: record.subtitle, ...clone(material), sourceRevision,
    archivedAt: record.deletedAt ?? null, builtin: record.id === starterRecord.id,
    sourceEditable: record.id !== starterRecord.id && record.status === "source" && !record.deletedAt };
}
export function createLegacyCatalog(store: SharedSnapshot<LocalState>, queue: MutationQueue, deletions: DeletionCoordinator,
  boot: () => Promise<void>, materialInUse: (courseId: string) => Promise<boolean> = async () => false): CatalogPort {
  const mutate = async (change: (state: LocalState) => void) => {
    await boot(); await queue.run(async () => { await deletions.refresh(); await store.update(change); });
  };
  const profile = (state: LocalState, id: string) => {
    assertNotDeleted(deletions, { kind: "learner", id });
    const found = state.learners.find(item => item.id === id);
    if (!found) throw Error("学习档案已变更，请重新选择。");
    return found;
  };
  const course = (state: LocalState, id: string) => {
    assertNotDeleted(deletions, { kind: "course", id });
    const found = id === starterRecord.id ? starterRecord : state.courses.find(item => item.id === id);
    if (!found) throw Error("课程不存在。");
    return found;
  };
  const nickname = (value: string) => {
    if (!value.trim() || value.trim().length > 16) throw Error("请输入 1–16 个字的昵称。");
    return value.trim();
  };
  return {
    selection() {
      const state = store.snapshot();
      const learnerIds = state.learners.filter(item => !deletions.isBlocked({ kind: "learner", id: item.id })).map(item => item.id);
      const availableCourseIds = [starterRecord, ...state.courses].filter(item => !item.deletedAt && !deletions.isBlocked({ kind: "course", id: item.id })).map(item => item.id);
      return { learnerIds, activeLearnerId: learnerIds.includes(state.activeLearnerId ?? "") ? state.activeLearnerId : null,
        defaultCourseId: starterRecord.id, availableCourseIds, learningCourseIds: Object.fromEntries(Object.entries(state.learningCourseIds)
          .filter(([id, courseId]) => learnerIds.includes(id) && availableCourseIds.includes(courseId))) };
    },
    async read() {
      await boot();
      return queue.run(async () => {
        await deletions.refresh();
        const state = await store.refresh();
        const learners = state.learners.filter(item => !deletions.isBlocked({ kind: "learner", id: item.id }));
        const courses = await Promise.all([starterRecord, ...state.courses].filter(item => !deletions.isBlocked({ kind: "course", id: item.id })).map(materialView));
        const available = new Set(courses.filter(item => !item.archivedAt).map(item => item.id));
        return { learners, activeLearnerId: learners.some(item => item.id === state.activeLearnerId) ? state.activeLearnerId : null,
          defaultCourseId: starterRecord.id, courses, learningCourseIds: Object.fromEntries(Object.entries(state.learningCourseIds)
            .filter(([id, courseId]) => learners.some(item => item.id === id) && available.has(courseId))) };
      });
    },
    async addLearner(value) {
      const name = nickname(value), id = newIdentity();
      await mutate(state => {
        if (state.learners.length >= 8) throw Error("此设备最多保留 8 个学习档案。");
        assertNotDeleted(deletions, { kind: "learner", id });
        state.learners.push({ id, nickname: name, createdAt: new Date().toISOString() }); state.activeLearnerId = id;
      });
      return id;
    },
    async renameLearner(id, value) { const name = nickname(value); await mutate(state => { profile(state, id).nickname = name; }); },
    async selectLearner(id) { await mutate(state => { profile(state, id); state.activeLearnerId = id; }); },
    async assignCourse(learnerId, courseId) {
      await mutate(state => {
        profile(state, learnerId);
        if (course(state, courseId).deletedAt) throw Error("已归档课程不能指定学习。");
        state.learningCourseIds[learnerId] = courseId;
      });
    },
    async createMaterial(input) {
      const record = newCourse();
      Object.assign(record, clone({ title: input.title, subtitle: input.subtitle, sourceText: input.sourceText, images: input.images, vocabularyImages: input.supplementImages }));
      await mutate(state => saveSevenStepCourse(state, record, deletions)); return record.id;
    },
    async updateMaterial(id, input) {
      const captured: MaterialInput = clone(input); await boot();
      await queue.run(async () => {
        await deletions.refresh();
        if (await materialInUse(id)) throw Error("教材已有已发布内容，原文保持原版本。");
        await store.update(state => {
          const record = course(state, id);
          if (id === starterRecord.id || record.deletedAt || record.status !== "source") throw Error("教材已用于课程设计，请在原模式编辑流程中处理。");
          Object.assign(record, { title: captured.title, subtitle: captured.subtitle, sourceText: captured.sourceText,
            images: captured.images, vocabularyImages: captured.supplementImages, updatedAt: new Date().toISOString() });
          validateCourseRecord(record);
        });
      });
    },
    async archiveCourse(id) { await mutate(state => { course(state, id); archiveCourse(state, id); }); },
    async restoreCourse(id) { await mutate(state => { course(state, id); restoreCourse(state, id); }); },
    async purgeCourse(id) { await boot(); await deletions.request({ kind: "course", id }); },
    async deleteLearner(id) { await boot(); await deletions.request({ kind: "learner", id }); },
  };
}
