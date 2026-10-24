import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { seedApplication, navigate, parentSpace } from "./fixtures/application";

async function fixture(page: Page, options: Record<string, boolean> = {}, mode = "seven-step") {
  await seedApplication(page, { mode, starter: mode === "passage-path" });
  await page.addInitScript(options => { (window as any).__updateOptions = options; }, options);
  await page.route("**/src/platform/app-update-bridge.ts", route => route.fulfill({ contentType: "application/javascript",
    body: readFileSync(new URL("./fixtures/app-update.js", import.meta.url), "utf8") }));
  await page.goto("/");
}
async function openUpdates(page: Page) {
  await page.locator(".frame-app-menu summary").click();
  await page.locator(".frame-app-menu").getByRole("button", { name: "应用更新", exact: true }).click();
  await expect(page.getByRole("heading", { name: "应用更新", exact: true })).toBeVisible();
}
const counts = (page: Page) => page.evaluate(() => {
  const state = (window as any).__updateState;
  return { checks: state.checks, downloads: state.downloads, installs: state.installs, settings: state.settings };
});

test("native back cannot resume learning while an installer launch is pending", async ({ page }) => {
  await fixture(page, { holdInstall: true, granted: true }); await openUpdates(page);
  await expect(page.getByRole("button", { name: "下载更新", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await page.getByRole("button", { name: "安装更新", exact: true }).click();
  await expect.poll(async () => (await counts(page)).installs).toBe(1);
  await page.evaluate(() => (window as any).__nativeBack());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole("heading", { name: "应用更新", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回原页面", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__finishUpdateInstall());
  await expect(page.getByRole("button", { name: "返回原页面", exact: true })).toBeEnabled();
  await page.evaluate(() => (window as any).__nativeBack());
  await expect(page.locator(".stage-list")).toBeVisible();
});

test("an update detour restores the editable material and its saved content", async ({ page }) => {
  await fixture(page); await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("更新返回测试");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await openUpdates(page);
  await page.getByRole("button", { name: "返回原页面", exact: true }).click();
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("更新返回测试");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello again, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect(page.getByText("教材已保存。", { exact: true })).toBeVisible();
});

test("students can update without entering parent settings, and permission never installs automatically", async ({ page }) => {
  await fixture(page);
  await expect(page.getByLabel("新版本提示")).toBeVisible();
  expect(await counts(page)).toEqual({ checks: 1, downloads: 0, installs: 0, settings: 0 });
  await openUpdates(page);
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "内容模型配置" })).toHaveCount(0);
  await expect(page.locator(".update-notes img")).toHaveCount(0);
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "安装更新", exact: true })).toBeEnabled();
  expect((await counts(page)).installs).toBe(0);
  await page.getByRole("button", { name: "安装更新", exact: true }).click();
  await page.getByRole("button", { name: "允许安装此应用的更新", exact: true }).click();
  expect(await counts(page)).toEqual({ checks: 1, downloads: 1, installs: 1, settings: 1 });
  await page.getByRole("button", { name: "安装更新", exact: true }).click();
  await expect(page.getByText("系统安装界面已打开，请按系统提示完成安装。", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/app-update-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "返回原页面", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "主导航", exact: true })).toBeVisible();
  await parentSpace(page); await navigate(page, "设置"); await openUpdates(page);
  await page.getByRole("button", { name: "返回原页面", exact: true }).click();
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
});

test("a delayed startup check does not block learning or interrupt a focused lesson", async ({ page }) => {
  await fixture(page, { holdCheck: true }, "passage-path");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".application-focusbar")).toBeVisible();
  await page.evaluate(() => (window as any).__finishUpdateCheck());
  await expect(page.getByLabel("新版本提示")).toHaveCount(0);
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await expect(page.getByLabel("新版本提示")).toBeVisible();
  expect((await counts(page)).downloads).toBe(0);
});

test("snoozing survives reload while manual checks still work", async ({ page }) => {
  await fixture(page); await expect(page.getByLabel("新版本提示")).toBeVisible();
  await page.getByLabel("新版本提示").getByRole("button", { name: "稍后", exact: true }).click();
  await page.reload(); await expect(page.locator(".stage-list")).toBeVisible();
  await expect(page.getByLabel("新版本提示")).toHaveCount(0);
  await openUpdates(page);
  expect((await counts(page)).checks).toBe(0);
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByText("发现新版本，可查看说明后下载。", { exact: true })).toBeVisible();
  expect((await counts(page)).checks).toBe(1);
});

test("download cancellation permits retry and startup connection failures stay local", async ({ page }) => {
  await fixture(page, { failCheck: true, holdDownload: true });
  await expect(page.locator(".stage-list")).toBeVisible();
  await expect.poll(async () => (await counts(page)).checks).toBe(1);
  await expect(page.locator(".frame-global-message[role=alert]")).toHaveCount(0);
  await openUpdates(page); await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("GitHub 暂时无法连接");
  await page.evaluate(() => { (window as any).__updateState.failCheck = false; });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "更新下载进度" })).toHaveAttribute("value", "1000000");
  await page.getByRole("button", { name: "取消下载", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("下载已取消");
  await page.evaluate(() => { (window as any).__updateState.holdDownload = false; });
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(page.getByRole("button", { name: "安装更新", exact: true })).toBeEnabled();
  expect((await counts(page)).downloads).toBe(2);
});
