import type { App } from "vue";
import { catalogKey } from "../platform/catalog";
import { passagePathStateCodec } from "../../packages/learning-modes/passage-path/state";
import { createSevenStepServices, sevenStepServicesKey, type SevenStepServices } from "../modes/seven-step/services";
import { createPassageServices, passageDeletionParticipant, passageServicesKey } from "../modes/passage-path/services";
import { MutationQueue, SharedSnapshot } from "../platform/shared-snapshot";
import { SnapshotRepository } from "../platform/snapshot-repository";
import type { OwnedResource } from "../platform/deletions";

export { catalogKey } from "../platform/catalog";
/** Composition root wires data owners; it makes no teaching decisions. */
export function createApplicationServices(cleanup?: (resource: OwnedResource) => Promise<void>) {
  const queue = new MutationQueue();
  const passageState = new SharedSnapshot(new SnapshotRepository(passagePathStateCodec), passagePathStateCodec);
  let sevenStep: SevenStepServices;
  const passage = createPassageServices(passageState, queue, () => sevenStep.catalog.selection(), id => sevenStep.readMaterial(id), async () => {
    await sevenStep.deletions.refresh(); await sevenStep.state.refresh();
  });
  sevenStep = createSevenStepServices({ queue, cleanup, extraParticipants: [passageDeletionParticipant(passageState)],
    materialInUse: async id => (await passageState.refresh()).publications.some(item => item.courseId === id) });
  return {
    sevenStep, passage, catalog: sevenStep.catalog, deletions: sevenStep.deletions,
    install(app: App) {
      app.provide(sevenStepServicesKey, sevenStep); app.provide(passageServicesKey, passage); app.provide(catalogKey, sevenStep.catalog);
    },
  };
}
