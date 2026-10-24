import { expect, test, type Page } from "@playwright/test";
import { adult, navigate, parentSpace, seedApplication } from "./fixtures/application";

async function thirdMode(page: Page, confirmation = false, invalidOverview = false) {
  await page.route("**/src/modes/registry.ts", route => route.fulfill({ contentType: "application/javascript", body: `
    import { createTeachingModeRegistry } from '/packages/learning-modes/contracts.ts';
    import { sevenStepRegistration } from '/src/modes/seven-step/register.ts';
    import { testAdaptiveRegistration } from '/tests/e2e/fixtures/adaptive-mode.ts';
    const adaptive = ${confirmation ? `{ ...testAdaptiveRegistration, surfaces: [...testAdaptiveRegistration.surfaces, 'confirm'], confirmationLabel: '家长复核' }` : 'testAdaptiveRegistration'};
    ${invalidOverview ? "adaptive.readOverview = async () => ({ courses: [], records: null, pendingCount: 0 });" : ''}
    export const teachingModes = createTeachingModeRegistry([sevenStepRegistration, adaptive], 'seven-step');
  ` }));
}

test("host authorization awaits the parent's decision and mode information has no selection commands", async ({ page }) => {
  await seedApplication(page, { mode: "test-adaptive" }); await thirdMode(page); await page.goto("/");
  await expect(page.getByRole("heading", { name: "测试自适应模式", exact: true })).toBeVisible();
  const keys = await page.evaluate(() => (window as any).__testWorkspace.modeKeys);
  expect(keys).not.toContain("select"); expect(keys).not.toContain("beforeSwitch");
  await page.evaluate(() => { void (window as any).__testWorkspace.authorize(); });
  await expect(page.getByLabel("7加5的答案")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__authorizationSettled)).toBe(false);
  await adult(page);
  await expect.poll(() => page.evaluate(() => (window as any).__authorizationSettled)).toBe(true);
  expect(await page.evaluate(() => (window as any).__authorizedActions)).toBe(1);
  await page.evaluate(() => { void (window as any).__testWorkspace.authorize(); });
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__authorizationSettled)).toBe(true);
  expect(await page.evaluate(() => (window as any).__authorizedActions)).toBe(1);
});

test("callbacks retained by an unloaded mode cannot navigate or report errors in the replacement workspace", async ({ page }) => {
  await seedApplication(page, { mode: "test-adaptive" }); await thirdMode(page); await page.goto("/");
  await expect(page.getByRole("heading", { name: "测试自适应模式", exact: true })).toBeVisible();
  await parentSpace(page); await navigate(page, "设置");
  await page.getByRole("radio", { name: /七步/ }).click();
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  await page.evaluate(async () => {
    const old = (window as any).__testWorkspace; old.notify(); await old.openParent(); await old.openSettings();
  });
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  await expect(page.getByText("已卸载模式的过期通知", { exact: true })).toHaveCount(0);
});

test("confirmation labels and supported surfaces come from registration, even without teaching data", async ({ page }) => {
  await seedApplication(page); await thirdMode(page, true); await page.goto("/"); await parentSpace(page);
  await expect(page.getByRole("button", { name: "家长复核", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "口语确认", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "家长复核", exact: true }).click();
  await expect(page.locator(".mode-workspace")).toHaveAttribute("data-mode-id", "test-adaptive");
  await navigate(page, "设置");
  await expect(page.getByRole("button", { name: "返回家长复核", exact: true })).toBeVisible();
});

test("a failed seven-step startup can reload its own data through the common host", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await expect(page.locator(".stage-list")).toBeVisible();
  const key = "native-document:lingonest.seven-step.v1";
  const original = await page.evaluate(key => sessionStorage.getItem(key), key);
  await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ revision: 30, payload: '{"formatVersion":999}' })), key);
  await page.reload(); await expect(page.getByRole("heading", { name: "学习模式数据暂时无法读取", exact: true })).toBeVisible();
  await page.evaluate(({ key, original }) => sessionStorage.setItem(key, original!), { key, original });
  await page.getByRole("button", { name: "重新读取模式数据", exact: true }).click();
  await expect(page.locator(".stage-list")).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(original);
});

test("a malformed mode overview stays inside its provider boundary and public navigation remains usable", async ({ page }) => {
  await seedApplication(page); await thirdMode(page, false, true); await page.goto("/");
  await expect(page.locator(".stage-list")).toBeVisible(); await parentSpace(page);
  await expect(page.getByText(/概况不符合接口或当前课程范围/)).toBeVisible();
  await navigate(page, "记录"); await expect(page.getByRole("button", { name: "查看作答", exact: true })).toBeVisible();
  await navigate(page, "设置"); await page.getByRole("button", { name: "管理孩子档案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "孩子档案", exact: true })).toBeVisible();
});

test("a passage refresh failure does not block navigation to public material and recovery settings", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
  const key = "native-document:lingonest.passage-path.v2", broken = JSON.stringify({ revision: 30, payload: '{"formatVersion":999}' });
  await page.evaluate(({ key, broken }) => sessionStorage.setItem(key, broken), { key, broken });
  await navigate(page, "课程", false);
  await expect(page.getByRole("heading", { name: "我的课程", exact: true })).toBeVisible();
  await parentSpace(page); await navigate(page, "设置");
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(broken);
});

test("a repaired global mode document can initialize again from public recovery settings", async ({ page }) => {
  await seedApplication(page);
  await page.addInitScript(() => sessionStorage.setItem("native-document:lingonest.mode-settings.v1", JSON.stringify({ revision: 30, payload: '{"formatVersion":999}' })));
  await page.goto("/"); await expect(page.getByRole("heading", { name: "暂时无法读取本机数据", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开设置", exact: true }).click(); await adult(page);
  const key = "native-document:lingonest.mode-settings.v1", repaired = JSON.stringify({ revision: 31, payload: JSON.stringify({ formatVersion: 1, activeModeId: "seven-step" }) });
  await page.evaluate(({ key, repaired }) => sessionStorage.setItem(key, repaired), { key, repaired });
  await page.getByRole("button", { name: "重新读取应用数据", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "家长导航" })).toBeVisible();
  await page.locator(".frame-actions").getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".stage-list")).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(repaired);
});
