import type { InjectionKey } from "vue";
import type { CatalogPort, MaterialCourse } from "../../../packages/learning-modes/catalog";
import { newCourse, starterRecord, validateCourseRecord, type CourseRecord } from "../../../packages/learning-modes/seven-step/authoring";
import type { LocalState } from "../../../packages/learning-modes/seven-step/state";
import type { MutationQueue, SharedSnapshot } from "../../platform/shared-snapshot";
import type { DeletionCoordinator } from "../../platform/deletions";
import { assertNotDeleted } from "../../platform/deletions";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const materialFields = (record: CourseRecord) => ({ title: record.title, subtitle: record.subtitle, sourceText: record.sourceText,
  images: record.images, supplementImages: record.vocabularyImages });
/** A mode-owned source snapshot, never a second editable public material. */
export function recordForMaterial(material: MaterialCourse, saved?: CourseRecord): CourseRecord {
  if (material.builtin) return copy(starterRecord);
  if (saved && (saved.status === "published" || JSON.stringify(materialFields(saved)) === JSON.stringify({ title: material.title, subtitle: material.subtitle,
    sourceText: material.sourceText, images: material.images, supplementImages: material.supplementImages }))) return { ...copy(saved), ...(material.archivedAt ? { deletedAt: material.archivedAt } : {}) };
  return { ...newCourse(), id: material.id, title: material.title, subtitle: material.subtitle, sourceText: material.sourceText,
    images: copy(material.images), vocabularyImages: copy(material.supplementImages), vocabulary: copy(saved?.vocabulary ?? []),
    ...(material.archivedAt ? { deletedAt: material.archivedAt } : {}) };
}
export function createSevenStepServices(options: {
  state: SharedSnapshot<LocalState>; queue: MutationQueue; catalog: CatalogPort; deletions: DeletionCoordinator;
  boot(): Promise<void>; refreshCatalog(): Promise<void>; retryCleanup(): Promise<void>; startupError(): string;
}) {
  return { ...options,
    async boot() { await options.boot(); await options.state.load(); },
    get startupError() { return options.startupError(); },
    saveCourse(state: LocalState, record: CourseRecord) {
      assertNotDeleted(options.deletions, { kind: "course", id: record.id });
      const material = options.catalog.snapshot().courses.find(item => item.id === record.id);
      if (!material || material.archivedAt || record.deletedAt) throw Error("课程已删除或不存在。");
      if (JSON.stringify(materialFields(record)) !== JSON.stringify(materialFields(recordForMaterial(material)))) throw Error("共同教材已变化，请重新打开内容准备。");
      validateCourseRecord(record);
      const index = state.courses.findIndex(item => item.id === record.id);
      if (index >= 0 && state.courses[index]!.status === "published") {
        if (JSON.stringify(state.courses[index]) !== JSON.stringify(record)) throw Error("已启用课程保持原版本，请新建课程保存变更。"); return;
      }
      if (index < 0) state.courses.push(copy(record)); else state.courses[index] = copy(record);
    },
  };
}
export type SevenStepServices = ReturnType<typeof createSevenStepServices>;
export const sevenStepServicesKey: InjectionKey<SevenStepServices> = Symbol("seven-step-services");
