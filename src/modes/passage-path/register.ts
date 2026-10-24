import type { Component } from "vue";
import type { TeachingModeRegistration } from "../../../packages/learning-modes/contracts";
import { passagePathIdentity } from "../../../packages/learning-modes/passage-path/identity";
export const passagePathRegistration: TeachingModeRegistration<Component> = {
  identity: passagePathIdentity,
  surfaces: ["learning", "authoring", "report"],
  loadExperience: async () => (await import("./Experience.vue")).default,
  readOverview: async (learnerId, materials) => (await import("./overview")).readOverview(learnerId, materials),
};
