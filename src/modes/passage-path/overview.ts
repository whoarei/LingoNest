import type { ModeOverview } from "../../../packages/learning-modes/contracts";
import type { MaterialCourse } from "../../../packages/learning-modes/catalog";
import { passagePathStateCodec } from "../../../packages/learning-modes/passage-path/state";
import { SnapshotRepository } from "../../platform/snapshot-repository";
import { makePassageAudioManifest } from "../../../packages/learning-modes/passage-path/authoring";
import { attemptRecord } from "../../../packages/learning-modes/passage-path/presentation";
import { currentMaterialReviews } from "./material";

export async function readOverview(learnerId: string | null, materials: readonly MaterialCourse[]): Promise<ModeOverview> {
  const state = await new SnapshotRepository(passagePathStateCodec).load();
  const visible = new Set(materials.map(item => item.id)), available = new Set(materials.filter(item => !item.archivedAt).map(item => item.id));
  const matching = currentMaterialReviews(state.candidates ?? [], materials);
  const candidates = [...new Map(matching.map(review => [review.package.courseId, review])).values()];
  const key = (item: { courseId: string; revision: string }) => JSON.stringify([item.courseId, item.revision]);
  const current = new Set(state.publications.map(key)), published = new Set(state.packages.map(key)), reviewable = new Set(candidates.map(item => key(item.package)));
  const matchingRefs = new Set(matching.map(item => key(item.package)));
  const ids = [...new Set([...state.publications.map(item => item.courseId), ...candidates.map(item => item.package.courseId)])].filter(id => available.has(id));
  return {
    resources: [...new Map([...state.packages, ...(state.candidates ?? []).map(item => item.package)].filter(pkg => visible.has(pkg.courseId)).map(pkg => [key(pkg), pkg])).values()].map(pkg => {
      const ref = key(pkg), label = current.has(ref) ? "已发布" : published.has(ref) ? "历史版本" : reviewable.has(ref) ? "候选题库" : matchingRefs.has(ref) ? "历史候选题库" : "过期候选题库";
      return { label: `课文闯关 · ${label}`, current: current.has(ref), manifest: makePassageAudioManifest(pkg) };
    }),
    courses: ids.map(courseId => ({ courseId, status: state.publications.some(item => item.courseId === courseId) ? "ready" : "review",
      pending: candidates.some(item => item.package.courseId === courseId && !state.publications.some(publication => publication.courseId === courseId && publication.revision === item.package.revision)) })),
    records: state.attempts.filter(item => item.learnerId === learnerId && visible.has(item.item.courseId)).map(item => attemptRecord(state, item)),
    pendingCount: 0,
  };
}
