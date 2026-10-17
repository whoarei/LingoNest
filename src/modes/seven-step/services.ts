import type { InjectionKey } from "vue";
import { LocalRepository } from "./repository";
import { sevenStepStateCodec, type LocalState } from "../../../packages/learning-modes/seven-step/state";
import { MutationQueue, SharedSnapshot } from "../../platform/shared-snapshot";
import { SnapshotRepository } from "../../platform/snapshot-repository";
import { DeletionCoordinator, deletionStateCodec, type DeletionParticipant, type OwnedResource } from "../../platform/deletions";
import { cleanOwnedResource } from "../../platform/resource-cleanup";
import { assertNotDeleted, createLegacyCatalog, materialView } from "./catalog";
import { sevenStepDeletionParticipant } from "./deletion-participant";
import { starterRecord } from "../../../packages/learning-modes/seven-step/authoring";

export function createSevenStepServices(options: {
  queue?: MutationQueue; extraParticipants?: DeletionParticipant[];
  state?: SharedSnapshot<LocalState>; cleanup?: (resource: OwnedResource) => Promise<void>;
  materialInUse?: (id: string) => Promise<boolean>;
} = {}) {
  const queue = options.queue ?? new MutationQueue();
  const state = options.state ?? new SharedSnapshot(new LocalRepository(), sevenStepStateCodec);
  const deletionState = new SharedSnapshot(new SnapshotRepository(deletionStateCodec), deletionStateCodec);
  const deletions = new DeletionCoordinator(deletionState, queue,
    [sevenStepDeletionParticipant(state), ...(options.extraParticipants ?? [])], options.cleanup ?? cleanOwnedResource);
  let loaded: Promise<void> | undefined;
  let startupError = "";
  const boot = () => loaded ??= (async () => {
    await state.load(); await deletions.load();
    try { await retryCleanup(); } catch (failure) { startupError = String(failure instanceof Error ? failure.message : failure); }
  })();
  async function retryCleanup() {
    await deletions.resume();
    const pending = state.snapshot();
    for (const job of pending.pendingCourseDeletions) await deletions.request({ kind: "course", id: job.record.id });
    for (const id of pending.pendingDeletions) await deletions.request({ kind: "learner", id });
  }
  const catalog = createLegacyCatalog(state, queue, deletions, boot, options.materialInUse);
  async function readMaterial(id: string) {
    await deletions.refresh();
    const current = await state.refresh(); assertNotDeleted(deletions, { kind: "course", id });
    const record = id === starterRecord.id ? starterRecord : current.courses.find(item => item.id === id);
    if (!record || record.deletedAt) throw Error("教材不可用。");
    return materialView(record);
  }
  return { state, queue, deletions, catalog, boot, retryCleanup, readMaterial, get startupError() { return startupError; } };
}
export type SevenStepServices = ReturnType<typeof createSevenStepServices>;
export const sevenStepServicesKey: InjectionKey<SevenStepServices> = Symbol("seven-step-compatibility-services");
