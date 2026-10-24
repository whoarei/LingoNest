import type { App, InjectionKey } from "vue";
import { catalogKey } from "../platform/catalog";
import { passagePathStateCodec } from "../../packages/learning-modes/passage-path/state";
import { sevenStepServicesKey } from "../modes/seven-step/services";
import { createLegacyApplicationData } from "./legacy-data";
import { createPassageServices, passageDeletionParticipant, passageServicesKey } from "../modes/passage-path/services";
import { MutationQueue, SharedSnapshot } from "../platform/shared-snapshot";
import { SnapshotRepository } from "../platform/snapshot-repository";
import type { OwnedResource } from "../platform/deletions";

export { catalogKey } from "../platform/catalog";
export const applicationServicesKey: InjectionKey<ReturnType<typeof createApplicationServices>> = Symbol("application-services");
/** Composition root wires data owners; it makes no teaching decisions. */
export function createApplicationServices(cleanup?: (resource: OwnedResource) => Promise<void>) {
  const queue = new MutationQueue();
  const passageState = new SharedSnapshot(new SnapshotRepository(passagePathStateCodec), passagePathStateCodec);
  const data = createLegacyApplicationData({ queue, cleanup, extraParticipants: [passageDeletionParticipant(passageState)],
    materialInUse: async id => (await passageState.refresh()).publications.some(item => item.courseId === id) });
  const passage = createPassageServices(passageState, queue, () => data.catalog.selection(), id => data.readMaterial(id), async () => {
    await data.deletions.refresh(); await data.state.refresh();
  });
  const services = {
    data, sevenStep: data, passage, catalog: data.catalog, deletions: data.deletions,
    install(app: App) {
      app.provide(applicationServicesKey, services);
      app.provide(sevenStepServicesKey, data); app.provide(passageServicesKey, passage); app.provide(catalogKey, data.catalog);
    },
  };
  return services;
}
