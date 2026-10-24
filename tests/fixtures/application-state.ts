import sample from "./seven-step-legacy.json";
import { emptyCatalogState, type CatalogState } from "../../packages/learning-modes/catalog-state";
import { emptyState, type LocalState } from "../../packages/learning-modes/seven-step/state";
export const catalogKey = "lingonest.catalog.v1", sevenKey = "lingonest.seven-step.v1";
/** Convert synthetic test content into separate seeds; application code never reads the old fixture. */
export function sampleCatalog(): CatalogState {
  return { ...emptyCatalogState(), learners: structuredClone(sample.snapshot.learners), activeLearnerId: sample.snapshot.activeLearnerId,
    learningCourseIds: { ...sample.snapshot.learningCourseIds }, courses: [...emptyCatalogState().courses, ...sample.snapshot.courses.map(record => ({
      id: record.id, title: record.title, subtitle: record.subtitle, sourceText: record.sourceText,
      images: structuredClone(record.images) as CatalogState["courses"][number]["images"], supplementImages: structuredClone(record.vocabularyImages),
      sourceRevision: "source.fixture.1", archivedAt: null, builtin: false,
    }))] };
}
export function sampleSeven(): LocalState {
  return { ...emptyState(), courses: structuredClone(sample.snapshot.courses) as LocalState["courses"], events: structuredClone(sample.snapshot.events) as LocalState["events"],
    runs: structuredClone(sample.snapshot.runs) as LocalState["runs"], confirmedCourses: structuredClone(sample.snapshot.confirmedCourses), lastObservedAt: sample.snapshot.lastObservedAt };
}
export const envelope = (value: unknown, revision = 7) => JSON.stringify({ revision, payload: JSON.stringify(value) });
export const seededDocuments = () => new Map([[catalogKey, envelope(sampleCatalog())], [sevenKey, envelope(sampleSeven())]]);
