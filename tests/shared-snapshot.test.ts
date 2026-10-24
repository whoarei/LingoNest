import { describe, expect, it } from "vitest";
import { SharedSnapshot } from "../src/platform/shared-snapshot";

describe("shared snapshot transaction isolation", () => {
  it("retries a failed initial read instead of caching its rejection forever", async () => {
    let fail = true;
    const codec = { storageKey: "test.retry", empty: () => ({ value: 0 }), decode: (payload: string) => JSON.parse(payload) as { value: number } };
    const snapshot = new SharedSnapshot({
      async load() { if (fail) throw Error("read failed"); return { value: 4 }; },
      async save() {},
    }, codec);
    await expect(snapshot.load()).rejects.toThrow("read failed");
    expect(() => snapshot.snapshot()).toThrow("尚未加载");
    fail = false;
    expect(await snapshot.load()).toEqual({ value: 4 });
  });
  it("keeps a concurrent refresh behind the complete asynchronous write", async () => {
    let committed = { value: 0 }, reads = 0;
    const codec = { storageKey: "test.isolation", empty: () => ({ value: 0 }), decode: (payload: string) => JSON.parse(payload) as { value: number } };
    const snapshot = new SharedSnapshot({
      async load() { reads++; return { ...committed }; },
      async save(value) { committed = { ...value }; },
    }, codec);
    await snapshot.load();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = snapshot.update(async value => { entered(); await gate; value.value++; });
    await started;
    const refresh = snapshot.refresh();
    await Promise.resolve();
    const readsWhileWriting = reads;
    release();
    await write;
    expect(await refresh).toEqual({ value: 1 });
    expect(readsWhileWriting).toBe(2);
    expect(snapshot.snapshot()).toEqual(committed);
  });

  it("continues refreshing and writing after a failed transaction without exposing uncommitted edits", async () => {
    let committed = { value: 0 }, fail = true;
    const codec = { storageKey: "test.failure", empty: () => ({ value: 0 }), decode: (payload: string) => JSON.parse(payload) as { value: number } };
    const snapshot = new SharedSnapshot({
      async load() { return { ...committed }; },
      async save(value) { if (fail) throw Error("write failed"); committed = { ...value }; },
    }, codec);
    await snapshot.load();
    await expect(snapshot.update(value => { value.value = 1; })).rejects.toThrow("write failed");
    expect(snapshot.snapshot()).toEqual({ value: 0 });
    expect(await snapshot.refresh()).toEqual({ value: 0 });
    fail = false;
    await snapshot.update(value => { value.value = 2; });
    expect(snapshot.snapshot()).toEqual({ value: 2 });
  });
});
