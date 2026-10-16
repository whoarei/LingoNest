import { createTeachingModeRegistry } from "../../packages/learning-modes/contracts";
import { sevenStepRegistration } from "./seven-step/register";

/** New methods register independent experiences, without inheriting a stage model. */
export const teachingModes = createTeachingModeRegistry(
  [sevenStepRegistration],
  sevenStepRegistration.identity.id,
);
