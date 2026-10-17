import type { TeachingModeCore } from "../contracts";
import type { PassageState } from "./model";
import { passagePathIdentity } from "./identity";
import { passagePathStateCodec } from "./state";
import * as authoring from "./authoring";
import * as prompts from "./prompts";
import * as runtime from "./runtime";
import * as reporting from "./reporting";
import { PassageStore } from "./store";

const modeAuthoring = { ...authoring, ...prompts };
const modeRuntime = { ...runtime, PassageStore };
/** Core only; production registration awaits the shared catalogue and complete experience. */
export const passagePathMode: TeachingModeCore<PassageState, typeof modeAuthoring, typeof modeRuntime, typeof reporting> = {
  identity: passagePathIdentity, state: passagePathStateCodec, authoring: modeAuthoring, runtime: modeRuntime, reporting,
};
