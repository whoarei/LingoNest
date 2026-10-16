/** Publication state is shared; content schemas and teaching decisions stay in each mode. */
export type CourseModeStatus = "missing" | "draft" | "review" | "ready";
export interface CourseModePublication {
  modeId: string;
  status: Exclude<CourseModeStatus, "missing">;
}
export function courseModeAccess(modeId: string, publications: readonly CourseModePublication[]) {
  const status: CourseModeStatus = publications.find(item => item.modeId === modeId)?.status ?? "missing";
  return { modeId, status, canLearn: status === "ready" };
}
