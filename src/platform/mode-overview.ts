import type { MaterialCourse } from "../../packages/learning-modes/catalog";
import type { ModeOverview, TeachingModeRegistration } from "../../packages/learning-modes/contracts";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
/** Isolate provider inputs and reject malformed/cross-course results at the boundary. */
export async function readModeOverview(mode: TeachingModeRegistration<unknown>, learnerId: string | null, materials: readonly MaterialCourse[]): Promise<ModeOverview> {
  if (!mode.readOverview) return { courses: [], records: [], pendingCount: 0 };
  const value = copy(await mode.readOverview(learnerId, copy(materials)));
  const visible = new Set(materials.map(item => item.id));
  const available = new Set(materials.filter(item => !item.archivedAt).map(item => item.id));
  const fail = (): never => { throw Error(`${mode.identity.title}返回的概况不符合接口或当前课程范围，其他模式仍可使用。`); };
  if (!value || !Array.isArray(value.courses) || !Array.isArray(value.records) || !Number.isSafeInteger(value.pendingCount) || value.pendingCount < 0 ||
    value.resources !== undefined && !Array.isArray(value.resources)) fail();
  if (new Set(value.courses.map(item => item?.courseId)).size !== value.courses.length ||
    value.courses.some(item => !item || !available.has(item.courseId) || !["missing", "draft", "review", "ready"].includes(item.status) || item.pending !== undefined && typeof item.pending !== "boolean")) fail();
  if (new Set(value.records.map(item => item?.id)).size !== value.records.length || !learnerId && (value.records.length > 0 || value.pendingCount > 0) ||
    value.records.some(item => !item || !text(item.id) || !visible.has(item.courseId) || !text(item.at) || !Number.isFinite(Date.parse(item.at)) || !text(item.title) ||
      item.outcome !== undefined && typeof item.outcome !== "string" || item.summary !== undefined && typeof item.summary !== "string" ||
      item.details !== undefined && (!Array.isArray(item.details) || item.details.some(detail => !detail || !text(detail.label) || typeof detail.value !== "string")))) fail();
  for (const resource of value.resources ?? []) {
    const manifest = resource?.manifest;
    if (!resource || !text(resource.label) || resource.current !== undefined && typeof resource.current !== "boolean" ||
      !manifest || !visible.has(manifest.courseId) || !text(manifest.courseVersion) || !text(manifest.title) || !Array.isArray(manifest.assets) ||
      new Set(manifest.assets.map(asset => asset?.id)).size !== manifest.assets.length || manifest.assets.some(asset => !asset || !text(asset.id) || !text(asset.text))) fail();
  }
  return value;
}
