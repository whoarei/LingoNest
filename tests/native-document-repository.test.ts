import { beforeEach, expect, it, vi } from "vitest";
import { SnapshotRepository } from "../src/platform/snapshot-repository";
import { LocalRepository } from "../src/modes/seven-step/repository";
import { catalogStateCodec } from "../packages/learning-modes/catalog-state";
import { modeSettingsCodec } from "../src/platform/mode-selection";
const native = vi.hoisted(() => ({ loadState: vi.fn(), saveState: vi.fn(), loadDocument: vi.fn(), saveDocument: vi.fn() }));
vi.mock("../src/native", () => ({ isAndroid: true, native }));
beforeEach(() => { vi.resetAllMocks(); native.loadDocument.mockResolvedValue({ revision: 0, payload: null }); native.saveDocument.mockResolvedValue({ revision: 1 }); });
it("stores public catalog, seven-step and settings in distinct native documents without the legacy store", async () => {
  const repositories = [new SnapshotRepository(catalogStateCodec), new LocalRepository(), new SnapshotRepository(modeSettingsCodec("seven-step"))];
  for (const repository of repositories) { const value = await repository.load(); await (repository as SnapshotRepository<unknown>).save(value); }
  expect(native.loadDocument.mock.calls.map(call => call[0].key)).toEqual(["lingonest.catalog.v1", "lingonest.seven-step.v1", "lingonest.mode-settings.v1"]);
  expect(native.saveDocument.mock.calls.map(call => call[0].key)).toEqual(["lingonest.catalog.v1", "lingonest.seven-step.v1", "lingonest.mode-settings.v1"]);
  expect(native.loadState).not.toHaveBeenCalled(); expect(native.saveState).not.toHaveBeenCalled();
});
