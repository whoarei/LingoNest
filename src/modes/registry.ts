import { createTeachingModeRegistry } from "../../packages/learning-modes/contracts";
import { sevenStepRegistration } from "./seven-step/register";
import { passagePathRegistration } from "./passage-path/register";

/** New methods register independent experiences, without inheriting a stage model. */
export const teachingModes = createTeachingModeRegistry(
  [sevenStepRegistration, passagePathRegistration],
  sevenStepRegistration.identity.id,
);
