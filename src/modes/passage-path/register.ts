import type { Component } from "vue";
import type { TeachingModeRegistration } from "../../../packages/learning-modes/contracts";
import { passagePathIdentity } from "../../../packages/learning-modes/passage-path/identity";
export const passagePathRegistration: TeachingModeRegistration<Component> = {
  identity: passagePathIdentity,
  loadExperience: async () => (await import("./Experience.vue")).default,
};
