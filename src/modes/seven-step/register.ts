import type { Component } from "vue";
import type { TeachingModeRegistration } from "../../../packages/learning-modes/contracts";
import { sevenStepIdentity } from "../../../packages/learning-modes/seven-step/identity";

export const sevenStepRegistration: TeachingModeRegistration<Component> = {
  identity: sevenStepIdentity,
  loadExperience: async () => (await import("./Experience.vue")).default,
  readOverview: async learnerId => (await import("./overview")).readOverview(learnerId),
};
