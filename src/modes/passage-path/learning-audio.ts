import type { CatalogSnapshot } from "../../../packages/learning-modes/catalog";
import type { PassagePackage, PassageState } from "../../../packages/learning-modes/passage-path/model";

/** Inspect only resources that can participate in this child's current round. */
export function learningAudioPackages(state: PassageState, catalog: CatalogSnapshot, courseId: string): PassagePackage[] {
  const learnerId = catalog.activeLearnerId;
  const publication = state.publications.find(item => item.courseId === courseId);
  const session = state.sessions.find(item => item.learnerId === learnerId && item.courseId === courseId &&
    item.revision === publication?.revision && item.status === "active");
  const key = (item: { courseId: string; revision: string }) => JSON.stringify([item.courseId, item.revision]);
  const references = new Set(session ? session.queue.map(key) : state.attempts.filter(item => item.learnerId === learnerId).map(item => key(item.item)));
  if (publication) references.add(key(publication));
  const available = new Set(catalog.courses.filter(item => !item.archivedAt).map(item => item.id));
  return state.publications.filter(item => available.has(item.courseId) && references.has(key(item)))
    .map(item => state.packages.find(pkg => key(pkg) === key(item))!);
}
