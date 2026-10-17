import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnapshotRepository } from "../src/platform/snapshot-repository";
import { teachingModes } from "../src/modes/registry";
import { passagePathMode } from "../packages/learning-modes/passage-path";
import { passagePathStateCodec } from "../packages/learning-modes/passage-path/state";
import { PassageStore, type PassagePersistence } from "../packages/learning-modes/passage-path/store";
import { makePassageAudioManifest } from "../packages/learning-modes/passage-path/authoring";
import { context, fixturePackage, responseFor } from "./fixtures/passage-path";
import legacy from "./fixtures/seven-step-legacy.json";

let values: Map<string, string>, failSave: boolean;
const key = passagePathStateCodec.storageKey;
beforeEach(() => {
  values = new Map([[legacy.storageKey, JSON.stringify({ revision: 7, payload: JSON.stringify(legacy.snapshot) })]]);
  failSave = false;
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { if (failSave && name === key) throw Error("模拟保存失败"); values.set(name, value); },
  });
  vi.stubGlobal("navigator", {});
});
const approval = () => ({ reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: makePassageAudioManifest(fixturePackage()).assets.map(asset => asset.id) });
async function boot(repository: PassagePersistence = new SnapshotRepository(passagePathStateCodec), getContext = () => context()) {
  const store = new PassageStore(repository, getContext);
  await store.load();
  return store;
}
async function begin() {
  const store = await boot();
  await store.publish(fixturePackage(), approval());
  await store.dispatch({ type: "start", sessionId: "session-1", seed: 3 });
  return store;
}

describe("passage-path transactions and persistence", () => {
  it("uses an independent snapshot and resumes without touching any legacy bytes alongside the registered experience", async () => {
    const old = values.get(legacy.storageKey);
    const store = await begin();
    const response = responseFor(store.snapshot(), "session-1");
    await store.dispatch({ type: "input", sessionId: "session-1", index: 0, response });
    const restored = await boot();
    expect(restored.snapshot().sessions[0]!.input).toEqual(response);
    expect(restored.snapshot().attempts).toHaveLength(0);
    await restored.dispatch({ type: "start", sessionId: "unused", seed: 99 });
    expect(restored.snapshot().sessions[0]!.queue).toEqual(store.snapshot().sessions[0]!.queue);
    expect(values.get(legacy.storageKey)).toBe(old);
    expect(passagePathMode.identity.id).toBe("passage-path");
    expect(teachingModes.modes.map(mode => mode.identity.id)).toEqual(["seven-step", "passage-path"]);
    const outside = restored.snapshot(); outside.sessions.length = 0;
    expect(restored.snapshot().sessions).toHaveLength(1);
  });
  it("serializes concurrent submissions and next commands without duplicate facts or skipped items", async () => {
    const store = await begin();
    const response = responseFor(store.snapshot(), "session-1");
    const command = { type: "submit", sessionId: "session-1", index: 0, attemptId: "attempt-one", response } as const;
    await Promise.all([store.dispatch(command), store.dispatch(command)]);
    expect(store.snapshot().attempts).toHaveLength(1);
    const revision = JSON.parse(values.get(key)!).revision;
    await store.dispatch(command);
    expect(JSON.parse(values.get(key)!).revision).toBe(revision);
    await Promise.all([store.dispatch({ type: "next", sessionId: "session-1", index: 0 }), store.dispatch({ type: "next", sessionId: "session-1", index: 0 })]);
    expect(store.snapshot().sessions[0]!.index).toBe(1);
    expect((await boot()).snapshot()).toEqual(store.snapshot());
  });
  it("keeps memory, input and feedback at their last saved values on failure, and can retry the same submission", async () => {
    const store = await begin();
    const before = store.snapshot();
    const command = { type: "submit", sessionId: "session-1", index: 0, attemptId: "retryable", response: responseFor(before, "session-1") } as const;
    failSave = true;
    await expect(store.dispatch(command)).rejects.toThrow("保存失败");
    expect(store.snapshot()).toEqual(before);
    expect((await boot()).snapshot()).toEqual(before);
    failSave = false;
    await store.dispatch(command);
    expect(store.snapshot().attempts).toHaveLength(1);
  });
  it("rejects a stale repository revision without advancing its in-memory cursor", async () => {
    const store = await begin();
    await store.dispatch({ type: "submit", sessionId: "session-1", index: 0, attemptId: "attempt-one", response: responseFor(store.snapshot(), "session-1") });
    const other = new SnapshotRepository(passagePathStateCodec);
    const snapshot = await other.load(); await other.save(snapshot);
    const before = store.snapshot();
    await expect(store.dispatch({ type: "next", sessionId: "session-1", index: 0 })).rejects.toThrow("另一个页面");
    expect(store.snapshot()).toEqual(before);
  });
  it("rejects queued commands after a child change rather than saving them against the next child's context", async () => {
    const original = await begin();
    const repo = new SnapshotRepository(passagePathStateCodec);
    let unblock!: () => void, entered!: () => void;
    const saving = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const port: PassagePersistence = { load: () => repo.load(), save: async state => { entered(); await gate; await repo.save(state); } };
    let ctx = context();
    const store = await boot(port, () => ctx);
    const response = responseFor(original.snapshot(), "session-1");
    const first = store.dispatch({ type: "input", sessionId: "session-1", index: 0, response });
    const second = store.dispatch({ type: "submit", sessionId: "session-1", index: 0, attemptId: "stale", response });
    const rejected = expect(second).rejects.toThrow("上下文已变化");
    await saving;
    ctx = { ...ctx, learnerId: "child-b" };
    unblock(); await first; await rejected;
    expect(store.snapshot().attempts).toHaveLength(0);
    expect(store.snapshot().sessions[0]).toMatchObject({ learnerId: "child-a", input: response });
    expect((await boot()).snapshot()).toEqual(store.snapshot());
  });
  it("preserves unsupported snapshots instead of replacing them with an empty document", async () => {
    const raw = JSON.stringify({ revision: 9, payload: '{"formatVersion":99}' });
    values.set(key, raw);
    const repository = new SnapshotRepository(passagePathStateCodec);
    await expect(boot(repository)).rejects.toThrow("不支持");
    await expect(repository.save(passagePathStateCodec.empty())).rejects.toThrow("尚未加载");
    expect(values.get(key)).toBe(raw);
    expect(JSON.parse(JSON.parse(values.get(legacy.storageKey)!).payload)).toEqual(legacy.snapshot);
  });
  it("keeps core imports independent of seven-step, Vue, native plugins and app facades", () => {
    const directory = "packages/learning-modes/passage-path";
    for (const relative of readdirSync(directory, { recursive: true }).map(String).filter(file => file.endsWith(".ts"))) {
      const file = resolve(directory, relative);
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/(?:from|import)\s*["'][^"']*(?:seven-step|\/src\/|learning-engine|vue|capacitor)/);
      expect(code, file).not.toMatch(/\bStageId\b|\.stageId\b/);
    }
  });
});
