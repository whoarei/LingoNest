import type { TeachingModeCore } from "../contracts";
import { sevenStepIdentity } from "./identity";
import * as authoring from "./authoring";
import * as prompts from "./prompts";
import * as engine from "./engine";
import * as reporting from "./reporting";
import { sevenStepStateCodec, type LocalState } from "./state";
import { course, exercises, stageDefinitions } from "./course";
import { makeCourseAudioSpec } from "./audio";

const modeAuthoring = { ...authoring, prompts, makeCourseAudioSpec };
const modeRuntime = { ...engine, stageDefinitions };

/** Seven-step structures are owned here, rather than imposed on other modes. */
export const sevenStepMode: TeachingModeCore<
  LocalState,
  typeof modeAuthoring,
  typeof modeRuntime,
  typeof reporting
> = {
  identity: sevenStepIdentity,
  state: sevenStepStateCodec,
  authoring: modeAuthoring,
  runtime: modeRuntime,
  reporting,
};

export const starterPackage = { course, exercises };
