import type { CatalogSnapshot, MaterialCourse, MaterialInput } from "./catalog";
import type { SnapshotCodec } from "./contracts";
import { starterMaterial } from "../materials/starter";

export type StoredMaterial = Omit<MaterialCourse, "sourceEditable" | "sourceEditBlockedReason">;
export interface CatalogState extends CatalogSnapshot { formatVersion: 1; courses: StoredMaterial[] }
export const identity = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
export function validateMaterial(input: MaterialInput, builtin = false) {
  if (!input || typeof input.title !== "string" || input.title.length > 100 || typeof input.subtitle !== "string" || input.subtitle.length > 120 ||
    typeof input.sourceText !== "string" || input.sourceText.length > 6000) throw Error("教材字段无效。");
  for (const images of [input.images, input.supplementImages]) {
    if (!Array.isArray(images) || images.length > 6 || new Set(images.map(image => image?.path)).size !== images.length || images.some(image => !image ||
      typeof image.path !== "string" || !(/^course-images\/[a-f0-9-]{36}\.jpg$/.test(image.path) || builtin && /^\/source\/[a-zA-Z0-9_.-]+\.jpg$/.test(image.path)) ||
      ![0, 90, 180, 270].includes(image.rotation))) throw Error("教材图片引用无效。");
  }
}
export const materialFields = (input: MaterialInput): MaterialInput => ({ title: input.title, subtitle: input.subtitle, sourceText: input.sourceText,
  images: copy(input.images), supplementImages: copy(input.supplementImages) });
export const emptyCatalogState = (): CatalogState => ({ formatVersion: 1, learners: [], activeLearnerId: null,
  defaultCourseId: starterMaterial.id, learningCourseIds: {}, courses: [{ ...copy(starterMaterial), sourceRevision: "source.starter.1", archivedAt: null, builtin: true }] });
export const catalogStateCodec: SnapshotCodec<CatalogState> = {
  storageKey: "lingonest.catalog.v1", empty: emptyCatalogState,
  decode(payload) {
    const value = JSON.parse(payload) as CatalogState;
    const fail = (): never => { throw Error("公共目录数据格式不受支持，已停止写入。"); };
    if (!value || value.formatVersion !== 1 || !Array.isArray(value.learners) || value.learners.length > 8 || !Array.isArray(value.courses) || value.courses.length > 301 ||
      !value.learningCourseIds || typeof value.learningCourseIds !== "object" || Array.isArray(value.learningCourseIds) ||
      Object.keys(value).some(key => !["formatVersion", "learners", "activeLearnerId", "defaultCourseId", "learningCourseIds", "courses"].includes(key))) fail();
    const learners = new Set<string>(), courses = new Set<string>();
    for (const learner of value.learners) {
      if (!learner || typeof learner.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(learner.id) || learners.has(learner.id) || typeof learner.nickname !== "string" || !learner.nickname.trim() || learner.nickname.length > 16 || !time(learner.createdAt)) fail();
      learners.add(learner.id);
    }
    for (const material of value.courses) {
      if (!material || !validId(material.id) || courses.has(material.id) || typeof material.builtin !== "boolean" ||
        !/^source\.[a-z0-9.]{1,100}$/.test(material.sourceRevision) || material.archivedAt !== null && !time(material.archivedAt) ||
        Object.keys(material).some(key => !["id", "title", "subtitle", "sourceText", "images", "supplementImages", "sourceRevision", "archivedAt", "builtin"].includes(key))) fail();
      validateMaterial(material, material.builtin);
      if (!material.builtin && !/^user\.[a-f0-9]{32}$/.test(material.id)) fail();
      if (material.builtin && (material.id !== starterMaterial.id || material.archivedAt !== null || JSON.stringify(materialFields(material)) !== JSON.stringify(materialFields(starterMaterial)))) fail();
      courses.add(material.id);
    }
    if (value.courses.filter(item => item.builtin).length !== 1 || value.defaultCourseId !== starterMaterial.id || !courses.has(value.defaultCourseId) ||
      value.courses.filter(item => !item.builtin && !item.archivedAt).length > 30 || value.activeLearnerId !== null && !learners.has(value.activeLearnerId) ||
      Object.entries(value.learningCourseIds).some(([learnerId, courseId]) => !learners.has(learnerId) || !value.courses.some(item => item.id === courseId && !item.archivedAt))) fail();
    return value;
  },
};
