import type { Component } from "vue";
import type { TeachingModeRegistration } from "../../../packages/learning-modes/contracts";
// Registered only by an intercepted E2E registry; never included in the app registry.
export const testAdaptiveRegistration: TeachingModeRegistration<Component> = {
  identity: { id: "test-adaptive", version: "1", title: "测试自适应模式" },
  surfaces: ["learning", "authoring", "report"],
  readOverview: async () => {
    const { SnapshotRepository } = await import("../../../src/platform/snapshot-repository");
    const saved = await new SnapshotRepository({ storageKey: "lingonest.test-adaptive.v1", empty: () => ({ statuses: {} as Record<string, "review" | "ready"> }), decode: payload => JSON.parse(payload) }).load();
    return { courses: Object.entries(saved.statuses as Record<string, "review" | "ready">).map(([courseId, status]) => ({ courseId, status })), records: [], pendingCount: 0 };
  },
  loadExperience: async () => (await import("./TestAdaptiveMode.vue")).default,
};
