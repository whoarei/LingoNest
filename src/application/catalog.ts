import type { CatalogPort, CatalogSnapshot, MaterialInput } from "../../packages/learning-modes/catalog";
import { copy, identity, materialFields, validateMaterial, type CatalogState } from "../../packages/learning-modes/catalog-state";
import type { MutationQueue, SharedSnapshot } from "../platform/shared-snapshot";
import { assertNotDeleted, type DeletionCoordinator, type DeletionParticipant } from "../platform/deletions";
export function createCatalog(state: SharedSnapshot<CatalogState>, queue: MutationQueue, deletions: DeletionCoordinator, boot: () => Promise<void>,
  publishedMaterials: () => Promise<ReadonlySet<string>>): CatalogPort {
  function project(value: CatalogState): CatalogSnapshot {
    const learners = value.learners.filter(item => !deletions.isBlocked({ kind: "learner", id: item.id }));
    const courses = value.courses.filter(item => !deletions.isBlocked({ kind: "course", id: item.id }));
    return { learners, courses, defaultCourseId: value.defaultCourseId, activeLearnerId: learners.some(item => item.id === value.activeLearnerId) ? value.activeLearnerId : null,
      learningCourseIds: Object.fromEntries(Object.entries(value.learningCourseIds).filter(([id, courseId]) => learners.some(item => item.id === id) && courses.some(item => item.id === courseId && !item.archivedAt))) };
  }
  const mutate = async (change: (value: CatalogState) => void) => {
    await boot(); await queue.run(async () => { await deletions.refresh(); await state.update(change); });
  };
  const profile = (value: CatalogState, id: string) => {
    assertNotDeleted(deletions, { kind: "learner", id });
    const result = value.learners.find(item => item.id === id); if (!result) throw Error("学习档案已变更，请重新选择。"); return result;
  };
  const course = (value: CatalogState, id: string) => {
    assertNotDeleted(deletions, { kind: "course", id });
    const result = value.courses.find(item => item.id === id); if (!result) throw Error("课程不存在。"); return result;
  };
  const nickname = (name: string) => { if (!name.trim() || name.trim().length > 16) throw Error("请输入 1–16 个字的昵称。"); return name.trim(); };
  return {
    snapshot: () => project(state.snapshot()),
    subscribe(listener) {
      const notify = () => listener(project(state.snapshot()));
      const stopCatalog = state.subscribe(notify), stopDeletion = deletions.state.subscribe(notify);
      return () => { stopCatalog(); stopDeletion(); };
    },
    selection() {
      const value = project(state.snapshot());
      return { activeLearnerId: value.activeLearnerId, learnerIds: value.learners.map(item => item.id), defaultCourseId: value.defaultCourseId,
        learningCourseIds: value.learningCourseIds, availableCourseIds: value.courses.filter(item => !item.archivedAt).map(item => item.id) };
    },
    async read() {
      await boot();
      return queue.run(async () => {
        await deletions.refresh(); const value = project(await state.refresh());
        let published: ReadonlySet<string> = new Set(), unavailable = false;
        try { published = await publishedMaterials(); } catch { unavailable = true; }
        value.courses = value.courses.map(item => ({ ...item, sourceEditable: !item.builtin && !item.archivedAt && !unavailable && !published.has(item.id),
          ...(unavailable && !item.builtin && !item.archivedAt ? { sourceEditBlockedReason: "暂时无法核对学习模式的发布状态，教材暂不可修改。已有内容保留。" } : {}) }));
        return value;
      });
    },
    async addLearner(name) {
      const id = identity(), normalized = nickname(name);
      await mutate(value => { if (value.learners.length >= 8) throw Error("此设备最多保留 8 个学习档案。"); value.learners.push({ id, nickname: normalized, createdAt: new Date().toISOString() }); value.activeLearnerId = id; }); return id;
    },
    async renameLearner(id, name) { const normalized = nickname(name); await mutate(value => { profile(value, id).nickname = normalized; }); },
    async selectLearner(id) { await mutate(value => { profile(value, id); value.activeLearnerId = id; }); },
    async assignCourse(learnerId, id) { await mutate(value => { profile(value, learnerId); if (course(value, id).archivedAt) throw Error("已归档课程不能指定学习。"); value.learningCourseIds[learnerId] = id; }); },
    async createMaterial(input) {
      const captured = materialFields(input), id = `user.${identity()}`; validateMaterial(captured);
      await mutate(value => { if (value.courses.filter(item => !item.builtin && !item.archivedAt).length >= 30) throw Error("此设备最多保存 30 门自建课程。");
        value.courses.push({ ...captured, id, sourceRevision: `source.${identity()}`, builtin: false, archivedAt: null }); }); return id;
    },
    async updateMaterial(id, input) {
      const captured = materialFields(input); validateMaterial(captured); await boot();
      await queue.run(async () => {
        await deletions.refresh(); if ((await publishedMaterials()).has(id)) throw Error("教材已有已发布内容，原文保持原版本。");
        await state.update(value => { const current = course(value, id); if (current.builtin || current.archivedAt) throw Error("教材不可修改。");
          if (JSON.stringify(materialFields(current)) !== JSON.stringify(captured)) Object.assign(current, captured, { sourceRevision: `source.${identity()}` }); });
      });
    },
    async archiveCourse(id) { await mutate(value => { const current = course(value, id); if (current.builtin || current.archivedAt) throw Error("只能删除课程列表中的自建课程。");
      current.archivedAt = new Date().toISOString(); for (const [learnerId, selected] of Object.entries(value.learningCourseIds)) if (selected === id) delete value.learningCourseIds[learnerId]; }); },
    async restoreCourse(id) { await mutate(value => { const current = course(value, id); if (!current.archivedAt) throw Error("课程不在已删除列表中。");
      if (value.courses.filter(item => !item.builtin && !item.archivedAt).length >= 30) throw Error("课程列表已满。"); current.archivedAt = null; }); },
    async purgeCourse(id) { await boot(); await deletions.request({ kind: "course", id }); },
    async deleteLearner(id) { await boot(); await deletions.request({ kind: "learner", id }); },
  };
}
export function catalogDeletionParticipant(state: SharedSnapshot<CatalogState>): DeletionParticipant {
  return { id: "catalog",
    async prepare(target) {
      const value = await state.refresh();
      if (target.kind === "learner") { if (!value.learners.some(item => item.id === target.id)) throw Error("学习档案不存在。"); return []; }
      const material = value.courses.find(item => item.id === target.id);
      if (!material || material.builtin || !material.archivedAt) throw Error("只能彻底删除已删除列表中的课程。");
      return [...material.images, ...material.supplementImages].map(image => ({ kind: "image" as const, path: image.path }));
    },
    async remove(target) { await state.update(value => {
      if (target.kind === "course") { value.courses = value.courses.filter(item => item.id !== target.id); for (const [id, selected] of Object.entries(value.learningCourseIds)) if (selected === target.id) delete value.learningCourseIds[id]; }
      else { value.learners = value.learners.filter(item => item.id !== target.id); delete value.learningCourseIds[target.id]; if (value.activeLearnerId === target.id) value.activeLearnerId = value.learners[0]?.id ?? null; }
    }); },
    async retained() { return (await state.refresh()).courses.flatMap(item => [...item.images, ...item.supplementImages]).filter(image => image.path.startsWith("course-images/")).map(image => ({ kind: "image" as const, path: image.path })); },
  };
}
