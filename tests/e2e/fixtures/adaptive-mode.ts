import type { Component } from "vue";
import type { TeachingModeRegistration } from "../../../packages/learning-modes/contracts";
// Registered only by an intercepted E2E registry; never included in the app registry.
export const testAdaptiveRegistration: TeachingModeRegistration<Component> = {
  identity: { id: "test-adaptive", version: "1", title: "测试自适应模式" },
  loadExperience: async () => (await import("./TestAdaptiveMode.vue")).default,
};
