import type { MaterialCourse } from "../../../packages/learning-modes/catalog";
import type { PassageReview } from "../../../packages/learning-modes/passage-path/model";
import { createPassageSource } from "../../../packages/learning-modes/passage-path/authoring";

export function passageSourceFromMaterial(material: MaterialCourse) {
  return createPassageSource({ courseId: material.id, revision: material.sourceRevision, title: material.title, sourceText: material.sourceText,
    images: [...material.images, ...material.supplementImages] });
}

/** Keep invalidated candidates as history, without advertising them as reviewable. */
export function currentMaterialReviews(reviews: readonly PassageReview[], materials: readonly MaterialCourse[]): PassageReview[] {
  const sources = new Map<string, string>();
  for (const material of materials) {
    try { sources.set(material.id, JSON.stringify(passageSourceFromMaterial(material))); }
    catch { /* Incomplete material needs correction before generation/review. */ }
  }
  return reviews.filter(review => sources.get(review.package.courseId) === JSON.stringify(review.package.source));
}
