import { describe, expect, it, vi } from "vitest";
import { createAppUpdate } from "../src/platform/app-update";
import type { AppUpdateAPI, UpdateInfo, UpdateManifest, UpdateProgress } from "../src/platform/app-update-bridge";

const DAY = 86400000;
const manifest: UpdateManifest = { schemaVersion: 1, applicationId: "cn.lingonest.app", versionName: "0.1.17", versionCode: 18,
  minSdkVersion: 24, size: 5000000, sha256: "a".repeat(64), publishedAt: "2026-10-24T15:00:00Z", notes: "更新说明",
  apkUrl: "https://github.com/whoarei/LingoNest/releases/download/v0.1.17/lingonest-0.1.17-release.apk" };
function fixture() {
  let time = Date.UTC(2026, 9, 24), progress: ((event: UpdateProgress) => void) | undefined;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const remove = vi.fn(async () => {});
  const api = { getInfo: vi.fn(async (): Promise<UpdateInfo> => ({ versionName: "0.1.16", versionCode: 17, sdkVersion: 29, supported: true, manifest })),
    check: vi.fn(async () => ({ manifest })), download: vi.fn(async () => {}), cancelDownload: vi.fn(async () => {}),
    install: vi.fn(async () => {}), openInstallSettings: vi.fn(async () => {}),
    addListener: vi.fn(async (_name: string, listener: (event: UpdateProgress) => void) => { progress = listener; return { remove }; }) } satisfies AppUpdateAPI;
  const create = (enabled = true) => createAppUpdate({ api, enabled, storage, now: () => time });
  return { api, create, remove, storage, values, advance: (ms: number) => { time += ms; }, progress: (received: number) => progress?.({ versionCode: 18, received, total: manifest.size }) };
}

describe("application updates", () => {
  it("rechecks if native manifest cache was lost despite a recent schedule timestamp", async () => {
    const f = fixture(); await f.create().start();
    f.api.getInfo.mockResolvedValueOnce({ versionName: "0.1.16", versionCode: 17, sdkVersion: 29, supported: true });
    const reopened = f.create(); await reopened.start();
    expect(f.api.check).toHaveBeenCalledTimes(2);
    expect(reopened.available.value).toBe(true);
  });
  it("checks once per day across launches while allowing explicit checks", async () => {
    const f = fixture(); await f.create().start();
    const next = f.create(); await next.start(); expect(f.api.check).toHaveBeenCalledTimes(1);
    await next.check(); expect(f.api.check).toHaveBeenCalledTimes(2);
    f.advance(DAY); await f.create().start(); expect(f.api.check).toHaveBeenCalledTimes(3);
  });
  it("keeps startup failures silent, backs off retries and exposes manual errors", async () => {
    const f = fixture(); f.api.check.mockRejectedValue(new Error("GitHub 无法连接"));
    const first = f.create(); await first.start(); expect(first.error.value).toBe("");
    await f.create().start(); expect(f.api.check).toHaveBeenCalledTimes(1);
    await first.check(); expect(first.error.value).toBe("GitHub 无法连接");
    f.advance(16 * 60000); await f.create().start(); expect(f.api.check).toHaveBeenCalledTimes(3);
  });
  it("persists a per-version snooze without suppressing the next release", async () => {
    const f = fixture(), first = f.create(); await first.start(); first.dismiss();
    const next = f.create(); await next.start(); expect(next.notify.value).toBe(false);
    f.api.check.mockResolvedValue({ manifest: { ...manifest, versionCode: 19, versionName: "0.1.18" } });
    await next.check(); expect(next.notify.value).toBe(true);
    f.advance(DAY); expect(first.notify.value).toBe(true);
  });
  it("never downloads automatically and blocks the installer when saving fails", async () => {
    const f = fixture(), update = f.create(); await update.start();
    expect(f.api.download).not.toHaveBeenCalled(); expect(f.api.install).not.toHaveBeenCalled();
    await update.download();
    await update.install(async () => { throw new Error("进度保存失败"); });
    expect(update.error.value).toBe("进度保存失败"); expect(f.api.install).not.toHaveBeenCalled();
    expect(update.downloaded.value).toBe(true);
  });
  it("launches the installer only on explicit attempts without requiring source settings", async () => {
    const f = fixture(), update = f.create(); await update.start(); await update.download();
    const save = vi.fn(async () => {}); await update.install(save);
    expect(save).toHaveBeenCalledOnce(); expect(f.api.install).toHaveBeenCalledWith({ versionCode: 18 });
    expect(f.api.openInstallSettings).not.toHaveBeenCalled();
    expect(update.message.value).toBe("系统安装界面已打开，请按系统提示完成安装。");
    // Managing an old grant is optional and never resumes installation automatically.
    await update.openInstallSettings(); expect(f.api.install).toHaveBeenCalledTimes(1);
    expect(f.api.openInstallSettings).toHaveBeenCalledOnce();
    await update.install(save);
    expect(f.api.install).toHaveBeenCalledTimes(2); expect(update.message.value).toContain("系统安装界面已打开");
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("keeps a verified download available after installer launch failure and permits explicit retry", async () => {
    const f = fixture(), update = f.create(); await update.start(); await update.download();
    f.api.install.mockRejectedValueOnce(new Error("无法打开系统安装界面"));
    const save = vi.fn(async () => {}); await update.install(save);
    expect(update.error.value).toBe("无法打开系统安装界面"); expect(update.message.value).toBe("");
    expect(update.downloaded.value).toBe(true); expect(update.busy.value).toBe(false);
    expect(f.api.openInstallSettings).not.toHaveBeenCalled();
    await update.install(save);
    expect(update.error.value).toBe(""); expect(f.api.download).toHaveBeenCalledOnce();
    expect(f.api.install).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledTimes(2);
  });
  it("keeps an active download busy until cancellation completes and permits retry", async () => {
    const f = fixture(), update = f.create(); await update.start();
    let reject!: (error: Error) => void;
    f.api.download.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const pending = update.download(); f.progress(100); expect(update.received.value).toBe(100);
    await update.cancel(); expect(update.downloading.value).toBe(true);
    reject(new Error("下载已取消")); await pending;
    expect(update.downloaded.value).toBe(false); await update.download(); expect(update.downloaded.value).toBe(true);
  });
  it("ignores late subscriptions and in-flight checks after disposal", async () => {
    const f = fixture(); let complete!: (value: { manifest: UpdateManifest }) => void;
    f.api.check.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const update = f.create(), starting = update.start();
    await vi.waitFor(() => expect(f.api.check).toHaveBeenCalled());
    update.dispose(); complete({ manifest: { ...manifest, versionCode: 19 } }); await starting;
    expect(f.remove).toHaveBeenCalledOnce(); expect(update.latest.value?.versionCode).toBe(18);
    const second = f.create(); f.api.addListener.mockImplementationOnce(async () => { second.dispose(); return { remove: f.remove }; });
    await second.start(); expect(f.remove).toHaveBeenCalledTimes(2);
  });
  it("prevents unsupported builds, incompatible devices and lower versions from installing", async () => {
    const f = fixture(); f.api.getInfo.mockResolvedValueOnce({ versionName: "0.1.16", versionCode: 17, sdkVersion: 29, supported: false, manifest });
    const debug = f.create(); await debug.start(); await debug.download(); expect(f.api.check).not.toHaveBeenCalled();
    expect(f.api.download).not.toHaveBeenCalled();
    const current = f.create(); await current.start();
    f.api.check.mockResolvedValueOnce({ manifest: { ...manifest, minSdkVersion: 30 } }); await current.check();
    expect(current.compatible.value).toBe(false); await current.download(); expect(f.api.download).not.toHaveBeenCalled();
    f.api.check.mockResolvedValueOnce({ manifest: { ...manifest, versionCode: 17 } }); await current.check(); expect(current.available.value).toBe(false);
    const browser = f.create(false); await browser.start(); expect(browser.unsupportedReason.value).toContain("浏览器");
  });
  it("continues to work when schedule storage is corrupt or unavailable", async () => {
    const f = fixture(); f.storage.getItem = () => "invalid json";
    f.storage.setItem = () => { throw new Error("storage blocked"); };
    const update = f.create(); await update.start(); expect(update.available.value).toBe(true); expect(update.error.value).toBe("");
  });
});
