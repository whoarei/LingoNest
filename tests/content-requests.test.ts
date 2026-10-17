import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn() }));
vi.mock("../src/platform/content", () => ({ contentRequest: transport.request, contentNative: { cancelRequest: transport.cancel } }));
import { createContentRequests } from "../src/platform/content-requests";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => { vi.resetAllMocks(); transport.cancel.mockResolvedValue(undefined); });
describe("content request ownership across mode unload", () => {
  it("never starts a request disposed before its startup continuation", async () => {
    const owner = createContentRequests(); const pending = owner.request("generation", "draft");
    await owner.dispose(); await expect(pending).rejects.toThrow("已取消");
    expect(transport.request).not.toHaveBeenCalled(); expect(transport.cancel).not.toHaveBeenCalled();
  });
  it("does not cancel another instance after the original request has completed", async () => {
    const old = createContentRequests(), next = createContentRequests(), response = deferred<string>();
    transport.request.mockResolvedValueOnce("old").mockReturnValueOnce(response.promise);
    expect(await old.request("generation", "old")).toBe("old");
    const pending = next.request("generation", "new"); await Promise.resolve();
    await old.dispose(); expect(transport.cancel).not.toHaveBeenCalled();
    response.resolve("new"); expect(await pending).toBe("new"); await next.dispose();
  });
  it("waits for owned native cancellation, ignores late results and never stops the new owner", async () => {
    const old = createContentRequests(), next = createContentRequests(), first = deferred<string>(), second = deferred<string>(), stopping = deferred<void>();
    transport.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); transport.cancel.mockReturnValueOnce(stopping.promise);
    const pendingOld = old.request("generation", "old"); await Promise.resolve();
    const cancelled = old.cancel(); const pendingNext = next.request("generation", "new");
    await Promise.resolve(); expect(transport.request).toHaveBeenCalledTimes(1);
    stopping.resolve(); await cancelled; await Promise.resolve();
    expect(transport.request).toHaveBeenCalledTimes(2);
    await old.dispose(); expect(transport.cancel).toHaveBeenCalledTimes(1);
    first.resolve("late"); await expect(pendingOld).rejects.toThrow("已取消");
    second.resolve("new"); expect(await pendingNext).toBe("new"); await next.dispose();
  });
});
