import { isAndroid, native } from "../native";
import type { OwnedResource } from "./deletions";

export async function cleanOwnedResource(resource: OwnedResource): Promise<void> {
  if (!isAndroid) return;
  if (resource.kind === "learner-recordings") return native.deleteRecordings({ learnerId: resource.learnerId });
  await native.deleteCourseResources({
    ...(resource.kind === "audio" ? { course: resource.course } : {}),
    images: resource.kind === "image" ? [resource.path] : [],
    recordings: resource.kind === "recording" ? [resource.path] : [],
  });
}
