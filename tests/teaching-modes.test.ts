import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeachingModeRegistry } from "../packages/learning-modes/contracts";
import { sevenStepMode, starterPackage } from "../packages/learning-modes/seven-step";
import { courseAudioSpec } from "../packages/learning-modes/seven-step/audio";
import { SnapshotRepository } from "../src/platform/snapshot-repository";
import { useLearning } from "../src/modes/seven-step/useLearning";
import { teachingModes } from "../src/modes/registry";
import legacy from "./fixtures/seven-step-legacy.json";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("window", {});
});

describe("independent teaching mode contracts", () => {
  it("registers lazy experiences without imposing stages, exercise or state types", async () => {
    const first = vi.fn(async () => ({ screen: "stages" }));
    const second = vi.fn(async () => ({ screen: "adaptive-session" }));
    const registry = createTeachingModeRegistry([
      { identity: { id: "seven-step", version: "1", title: "七步" }, loadExperience: first },
      { identity: { id: "adaptive", version: "3", title: "独立方法" }, loadExperience: second },
    ], "seven-step");
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(await registry.requireMode("adaptive").loadExperience()).toEqual({ screen: "adaptive-session" });
    expect(first).not.toHaveBeenCalled();
    expect(() => registry.requireMode("not-installed")).toThrow("尚未安装");
    expect(teachingModes.modes.map((mode) => mode.identity.id)).toEqual(["seven-step", "passage-path"]);
  });

  it("rejects ambiguous registrations and unknown defaults without replacing data", () => {
    const mode = { identity: { id: "example", version: "1", title: "示例" }, loadExperience: async () => null };
    expect(() => createTeachingModeRegistry([mode, mode], "example")).toThrow("重复");
    expect(() => createTeachingModeRegistry([mode], "missing")).toThrow("尚未安装");
    expect(() => createTeachingModeRegistry([{ ...mode, identity: { ...mode.identity, id: "../bad" } }], "../bad")).toThrow("无效");
  });
  it("allows an application with no teaching plugins to retain its management shell", () => {
    const registry = createTeachingModeRegistry([], "seven-step");
    expect(registry.modes).toEqual([]);
    expect(() => registry.requireMode("seven-step")).toThrow("尚未安装");
  });

  it("shares only snapshot mechanics and leaves payload semantics to the codec", async () => {
    const codec = {
      storageKey: "test.independent-mode",
      empty: () => ({ skills: { join: 0.25 }, queue: ["task-2"] }),
      decode: (payload: string) => {
        const parsed = JSON.parse(payload);
        if (!parsed.skills || !Array.isArray(parsed.queue)) throw Error("invalid mode payload");
        return parsed as { skills: { join: number }; queue: string[] };
      },
    };
    const repository = new SnapshotRepository(codec);
    await expect(repository.save(codec.empty())).rejects.toThrow("尚未加载");
    const state = await repository.load();
    state.skills.join = 0.6;
    await repository.save(state);
    expect(await new SnapshotRepository(codec).load()).toEqual(state);
    expect(values.has(legacy.storageKey)).toBe(false);
    const stale = new SnapshotRepository(codec);
    await stale.load();
    await repository.save({ ...state, queue: ["task-3"] });
    await expect(stale.save(state)).rejects.toThrow("另一个页面");
    expect((await new SnapshotRepository(codec).load()).queue).toEqual(["task-3"]);
  });

  it("does not reset or overwrite an unreadable mode snapshot", async () => {
    const raw = JSON.stringify({ revision: 4, payload: '{"formatVersion":999}' });
    values.set(sevenStepMode.state.storageKey, raw);
    const repository = new SnapshotRepository(sevenStepMode.state);
    await expect(repository.load()).rejects.toThrow("不受支持");
    await expect(repository.save(sevenStepMode.state.empty())).rejects.toThrow("尚未加载");
    expect(values.get(sevenStepMode.state.storageKey)).toBe(raw);
  });
});

describe("separated teaching storage", () => {
  it("uses an independent seven-step key and never reads the old combined document", async () => {
    values.set(legacy.storageKey, "{broken old snapshot");
    expect(await new SnapshotRepository(sevenStepMode.state).load()).toEqual(sevenStepMode.state.empty());
    expect(sevenStepMode.state.storageKey).toBe("lingonest.seven-step.v1");
    expect(digest(starterPackage)).toBe(legacy.starterDigest);
    expect(digest(courseAudioSpec)).toBe(legacy.audioDigest);
  });
});

describe("module dependency boundaries", () => {
  const sourceFiles = (directory: string) => readdirSync(directory, { recursive: true })
    .map(String).filter((file) => /\.(ts|vue)$/.test(file)).map((file) => resolve(directory, file));
  it("keeps the complete seven-step core independent of Vue, app infrastructure and compatibility facades", () => {
    for (const file of sourceFiles("packages/learning-modes/seven-step")) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/(?:from|import)\s*["'][^"']*(?:\/src\/|learning-engine|vue|capacitor)/);
    }
  });
  it("keeps both teaching cores independent of each other and public application views free of teaching logic", () => {
    for (const file of sourceFiles("packages/learning-modes/passage-path")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/(?:from|import)\s*["'][^"']*(?:\/src\/|seven-step|learning-engine|vue|capacitor)/);
    }
    for (const file of sourceFiles("packages/learning-modes/seven-step")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/(?:from|import)\s*["'][^"']*passage-path/);
    }
    const views = sourceFiles("src/application").filter(file => !/legacy-(?:catalog|data)\.ts$|services\.ts$/.test(file));
    for (const file of views) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["'][^"']*(?:seven-step|passage-path|learning-engine)/);
    }
  });
  it("keeps host contracts and shared platform/controls free of seven-step assumptions", () => {
    const files = ["packages/learning-modes/contracts.ts", "src/App.vue", "src/modes/ModeHost.vue", ...sourceFiles("src/platform"), ...sourceFiles("src/components")];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*(?:seven-step|course-library|course-speech|useLearning|learning-engine|parent-report)/);
      expect(source, file).not.toMatch(/\bStageId\b|\.stageId\b/);
    }
  });
  it("keeps mode services independent of the application composition root and public storage codec", () => {
    for (const file of sourceFiles("src/modes")) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*application\/(?:services|catalog)["']/);
      expect(source, file).not.toMatch(/from\s+["'][^"']*catalog-state["']/);
    }
  });
});
