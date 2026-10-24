import type { InjectionKey } from "vue";
import { createLegacyApplicationData } from "../../application/legacy-data";
/** Compatibility facade for the original seven-step controller and tests. */
export const createSevenStepServices = createLegacyApplicationData;
export type SevenStepServices = ReturnType<typeof createLegacyApplicationData>;
export const sevenStepServicesKey: InjectionKey<SevenStepServices> = Symbol("seven-step-compatibility-services");
