import { reactive, type App, type InjectionKey } from "vue";
import { catalogKey } from "../platform/catalog";
import { catalogStateCodec } from "../../packages/learning-modes/catalog-state";
import { passagePathStateCodec } from "../../packages/learning-modes/passage-path/state";
import { sevenStepStateCodec } from "../../packages/learning-modes/seven-step/state";
import { createSevenStepServices, sevenStepServicesKey } from "../modes/seven-step/services";
import { sevenStepDeletionParticipant } from "../modes/seven-step/deletion-participant";
import { createCatalog, catalogDeletionParticipant } from "./catalog";
import { createPassageServices, passageDeletionParticipant, passageServicesKey } from "../modes/passage-path/services";
import { MutationQueue, SharedSnapshot } from "../platform/shared-snapshot";
import { SnapshotRepository } from "../platform/snapshot-repository";
import { assertNotDeleted, DeletionCoordinator, deletionStateCodec, type OwnedResource } from "../platform/deletions";
import { cleanOwnedResource } from "../platform/resource-cleanup";

export { catalogKey } from "../platform/catalog";
export const applicationServicesKey: InjectionKey<ReturnType<typeof createApplicationServices>> = Symbol("application-services");
/** Only this composition root knows which data owners are installed. */
export function createApplicationServices(cleanup: (resource: OwnedResource) => Promise<void> = cleanOwnedResource) {
  const queue = new MutationQueue();
  const catalogState = new SharedSnapshot(new SnapshotRepository(catalogStateCodec), catalogStateCodec);
  const sevenState = new SharedSnapshot(new SnapshotRepository(sevenStepStateCodec), sevenStepStateCodec);
  const passageState = new SharedSnapshot(new SnapshotRepository(passagePathStateCodec), passagePathStateCodec);
  const deletionState = new SharedSnapshot(new SnapshotRepository(deletionStateCodec), deletionStateCodec);
  const deletions = new DeletionCoordinator(deletionState, queue,
    [sevenStepDeletionParticipant(sevenState), passageDeletionParticipant(passageState), catalogDeletionParticipant(catalogState)], cleanup);
  const cleanupStatus = reactive({ pending: 0, error: "" });
  deletionState.subscribe(value => { cleanupStatus.pending = value.plans.length; });
  let loaded: Promise<void> | undefined;
  const retryCleanup = async () => {
    try { await deletions.resume(); cleanupStatus.error = ""; }
    catch (failure) { cleanupStatus.error = failure instanceof Error ? failure.message : String(failure); throw failure; }
  };
  const boot = () => loaded ??= (async () => {
    await catalogState.load(); await deletions.load();
    try { await retryCleanup(); } catch { /* Pending targets remain blocked; unrelated public data stays usable. */ }
  })().catch(failure => { loaded = undefined; throw failure; });
  const catalog = createCatalog(catalogState, queue, deletions, boot, async () => {
    const [seven, passage] = await Promise.all([sevenState.refresh(), passageState.refresh()]);
    return new Set([...seven.courses.filter(item => item.status === "published").map(item => item.id), ...passage.publications.map(item => item.courseId)]);
  });
  const refreshCatalog = async () => { await deletions.refresh(); await catalogState.refresh(); };
  const readMaterial = async (id: string) => {
    await refreshCatalog(); assertNotDeleted(deletions, { kind: "course", id });
    const material = catalog.snapshot().courses.find(item => item.id === id);
    if (!material || material.archivedAt) throw Error("教材不可用。"); return material;
  };
  const sevenStep = createSevenStepServices({ state: sevenState, queue, catalog, deletions, boot, refreshCatalog, retryCleanup, startupError: () => cleanupStatus.error });
  const passage = createPassageServices(passageState, queue, () => catalog.selection(), readMaterial, refreshCatalog);
  const services = { catalogState, sevenStep, passage, catalog, deletions, boot, retryCleanup, cleanupStatus,
    install(app: App) { app.provide(applicationServicesKey, services); app.provide(sevenStepServicesKey, sevenStep);
      app.provide(passageServicesKey, passage); app.provide(catalogKey, catalog); },
  };
  return services;
}
