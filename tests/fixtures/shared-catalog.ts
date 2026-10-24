import { recordForMaterial } from "../../src/modes/seven-step/services";
import { vi } from "vitest";
import { createApplicationServices } from "../../src/application/services";
import type { OwnedResource } from "../../src/platform/deletions";
import { compilePassagePackage, makePassageAudioManifest } from "../../packages/learning-modes/passage-path/authoring";
import { passageSourceFromMaterial } from "../../src/modes/passage-path/services";
import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";
import type { RuntimeContext } from "../../packages/learning-modes/passage-path/model";
import { seededDocuments } from "./application-state";
import { fixtureDraft } from "./passage-path";

export const image = { path: "course-images/12345678-1234-1234-1234-123456789abc.jpg", rotation: 0 as const };
export const sharedImage = { path: "course-images/12345678-1234-1234-1234-123456789def.jpg", rotation: 90 as const };
export function setupCatalog() {
  const values = seededDocuments();
  const control = { failWrite: (_key: string, _value: string) => false };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (control.failWrite(key, value)) throw Error("模拟保存失败"); values.set(key, value); },
  });
  vi.stubGlobal("navigator", {}); vi.stubGlobal("window", {});
  const cleanup = vi.fn(async (_resource: OwnedResource) => {});
  return { values, control, cleanup, services: createApplicationServices(cleanup) };
}
export const materialInput = () => ({ title: starterRecord.title, subtitle: starterRecord.subtitle, sourceText: starterRecord.sourceText,
  images: [image, sharedImage], supplementImages: [] });
export async function materialPackage(services: ReturnType<typeof createApplicationServices>, courseId: string, revision = "package-1") {
  const material = (await services.catalog.read()).courses.find(item => item.id === courseId)!;
  return compilePassagePackage({ source: passageSourceFromMaterial(material), draft: fixtureDraft(), modeInstanceId: "instance-1", revision,
    model: "reviewed-test-fixture", generatedAt: "2026-10-17T10:00:00.000Z" });
}
export async function beginShared(services: ReturnType<typeof createApplicationServices>) {
  const courseId = await services.catalog.createMaterial(materialInput());
  await services.catalog.assignCourse("legacy-a", courseId);
  let ctx: RuntimeContext = { activeModeId: "passage-path", learnerId: "legacy-a", courseId,
    courses: [{ courseId, available: true, audioReady: true }], clock: { at: "2026-10-17T10:00:00.000Z", trusted: true } };
  const store = services.passage.createStore(() => ctx);
  await store.load();
  const pkg = await materialPackage(services, courseId);
  const material = services.catalog.snapshot().courses.find(item => item.id === courseId)!;
  await services.sevenStep.state.update(value => { value.courses.push(recordForMaterial(material)); });
  await store.publish(pkg, { reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: makePassageAudioManifest(pkg).assets.map(item => item.id) });
  await store.dispatch({ type: "start", sessionId: "session-a", seed: 7 });
  return { courseId, store, pkg, setContext: (next: RuntimeContext) => { ctx = next; }, getContext: () => ctx };
}
