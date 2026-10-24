import type { ModeOverview } from "../../../packages/learning-modes/contracts";
import type { MaterialCourse } from "../../../packages/learning-modes/catalog";
import { passagePathStateCodec } from "../../../packages/learning-modes/passage-path/state";
import { SnapshotRepository } from "../../platform/snapshot-repository";
import { makePassageAudioManifest } from "../../../packages/learning-modes/passage-path/authoring";
import { attemptRecord } from "../../../packages/learning-modes/passage-path/presentation";

export async function readOverview(learnerId: string | null, materials: readonly MaterialCourse[]): Promise<ModeOverview> {
  const state = await new SnapshotRepository(passagePathStateCodec).load();
  const visible = new Set(materials.map(item => item.id)), available = new Set(materials.filter(item => !item.archivedAt).map(item => item.id));
  const ids = [...new Set([...state.publications.map(item => item.courseId), ...(state.candidates ?? []).map(item => item.package.courseId)])].filter(id => available.has(id));
  return {
    resources: [...new Map([...state.packages, ...(state.candidates ?? []).map(item => item.package)].filter(pkg => visible.has(pkg.courseId)).map(pkg => [pkg.courseId + ":" + pkg.revision, pkg])).values()].map(pkg => ({ label: `课文闯关 · ${state.publications.some(item => item.courseId === pkg.courseId && item.revision === pkg.revision) ? "已发布" : "候选题库"}`, current: state.publications.some(item => item.courseId === pkg.courseId && item.revision === pkg.revision), manifest: makePassageAudioManifest(pkg) })),
    courses: ids.map(courseId => ({ courseId, status: state.publications.some(item => item.courseId === courseId) ? "ready" : "review",
      pending: (state.candidates ?? []).some(item => item.package.courseId === courseId && !state.publications.some(publication => publication.courseId === courseId && publication.revision === item.package.revision)) })),
    records: state.attempts.filter(item => item.learnerId === learnerId && visible.has(item.item.courseId)).map(item => attemptRecord(state, item)),
    pendingCount: 0,
  };
}
