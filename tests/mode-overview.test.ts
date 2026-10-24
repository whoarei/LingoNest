import { describe, expect, it } from "vitest";
import type { ModeOverview, TeachingModeRegistration } from "../packages/learning-modes/contracts";
import { readModeOverview } from "../src/platform/mode-overview";
import { sampleCatalog } from "./fixtures/application-state";

const materials = () => sampleCatalog().courses;
const overview = (): ModeOverview => ({ courses: [{ courseId: materials()[0]!.id, status: "ready" }], pendingCount: 0,
  records: [{ id: "record-a", courseId: materials()[0]!.id, at: "2026-10-24T08:00:00.000Z", title: "作答" }],
  resources: [{ label: "发布内容", manifest: { courseId: materials()[0]!.id, title: "教材", courseVersion: "1", assets: [{ id: "line-a", text: "Hello." }] } }] });
const registration = (read: NonNullable<TeachingModeRegistration<unknown>["readOverview"]>): TeachingModeRegistration<unknown> => ({
  identity: { id: "test", title: "测试模式", version: "1" }, surfaces: ["learning", "report"], loadExperience: async () => null, readOverview: read,
});

describe("overview provider boundary", () => {
  it("gives each provider an independent public snapshot and detaches returned facts", async () => {
    const publicMaterials = materials(), original = structuredClone(publicMaterials), facts = overview();
    const result = await readModeOverview(registration(async (_learner, supplied) => {
      supplied[0]!.title = "插件局部修改"; supplied[0]!.images.length = 0; return facts;
    }), "child-a", publicMaterials);
    expect(publicMaterials).toEqual(original);
    facts.records[0]!.title = "稍后修改返回对象";
    expect(result.records[0]!.title).toBe("作答");
  });

  it.each(["foreign-course", "foreign-record", "foreign-resource", "duplicate-record", "invalid-count", "invalid-time", "invalid-details", "invalid-assets"])("rejects a malformed provider result: %s", async kind => {
    const facts = overview();
    if (kind === "foreign-course") facts.courses[0]!.courseId = "absent";
    if (kind === "foreign-record") facts.records[0]!.courseId = "absent";
    if (kind === "foreign-resource") facts.resources![0]!.manifest.courseId = "absent";
    if (kind === "duplicate-record") facts.records.push({ ...facts.records[0]! });
    if (kind === "invalid-count") facts.pendingCount = NaN;
    if (kind === "invalid-time") facts.records[0]!.at = "unknown";
    if (kind === "invalid-details") facts.records[0]!.details = [{ label: "答案", value: 42 as any }];
    if (kind === "invalid-assets") facts.resources![0]!.manifest.assets.push({ ...facts.resources![0]!.manifest.assets[0]! });
    await expect(readModeOverview(registration(async () => facts), "child-a", materials())).rejects.toThrow("接口或当前课程范围");
  });

  it("permits historical records and resources for archived courses, while excluding them from learning status", async () => {
    const scope = materials(); scope[1]!.archivedAt = "2026-10-24T08:00:00.000Z";
    const facts = overview(); facts.records[0]!.courseId = scope[1]!.id; facts.resources![0]!.manifest.courseId = scope[1]!.id;
    expect(await readModeOverview(registration(async () => facts), "child-a", scope)).toEqual(facts);
    facts.courses.push({ courseId: scope[1]!.id, status: "ready" });
    await expect(readModeOverview(registration(async () => facts), "child-a", scope)).rejects.toThrow();
  });

  it("does not accept personal records when there is no selected learner", async () => {
    await expect(readModeOverview(registration(async () => overview()), null, materials())).rejects.toThrow();
  });
});
