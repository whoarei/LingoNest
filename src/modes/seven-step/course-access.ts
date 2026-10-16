import { courseModeAccess, type CourseModePublication } from "../../../packages/learning-modes/availability";
import type { CourseRecord } from "../../../packages/learning-modes/seven-step/authoring";
import { sevenStepIdentity } from "../../../packages/learning-modes/seven-step/identity";
export function sevenStepCourseAccess(modeId: string, record: CourseRecord) {
  const status: CourseModePublication["status"] = record.status === "published" ? "ready" : record.status === "review" ? "review" : "draft";
  return courseModeAccess(modeId, [{ modeId: sevenStepIdentity.id, status }]);
}
