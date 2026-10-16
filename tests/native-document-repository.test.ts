import { beforeEach, expect, it, vi } from "vitest";
import { SnapshotRepository } from "../src/platform/snapshot-repository";
import { LocalRepository } from "../src/modes/seven-step/repository";
import { modeSettingsCodec } from "../src/platform/mode-selection";
import legacy from "./fixtures/seven-step-legacy.json";
const native = vi.hoisted(() => ({ loadState: vi.fn(), saveState: vi.fn(), loadDocument: vi.fn(), saveDocument: vi.fn() }));
vi.mock("../src/native", () => ({ isAndroid: true, native }));
beforeEach(() => {
  vi.resetAllMocks();
  native.loadState.mockResolvedValue({ revision: 7, payload: JSON.stringify(legacy.snapshot) });
  native.loadDocument.mockResolvedValue({ revision: 0, payload: null });
  native.saveDocument.mockResolvedValue({ revision: 1 });
  native.saveState.mockResolvedValue({ revision: 8 });
});
it("routes global settings and other mode documents to independent native slots, keeping seven-step on its original slot", async () => {
  const original = new LocalRepository();
  const legacyState = await original.load();
  expect(legacyState).toEqual(legacy.snapshot);
  const settings = new SnapshotRepository(modeSettingsCodec("seven-step"));
  const value = await settings.load(); await settings.save(value);
  const other = new SnapshotRepository({ storageKey: "test.mode.other", empty: () => ({ tasks: [] }), decode: JSON.parse });
  await other.load(); await other.save({ tasks: ["one"] });
  expect(native.loadDocument.mock.calls.map(call => call[0].key)).toEqual(["lingonest.mode-settings.v1", "test.mode.other"]);
  expect(native.saveState).not.toHaveBeenCalled();
  await original.save(legacyState);
  expect(native.saveState).toHaveBeenCalledWith({ expectedRevision: 7, payload: JSON.stringify(legacy.snapshot) });
  expect(native.saveDocument).toHaveBeenCalledTimes(2);
});
