import { expect, test, type Page } from "@playwright/test";
import { adult, navigate, parentSpace, seedApplication, snapshot, switchMode } from "./fixtures/application";
const modeKey = "native-document:lingonest.mode-settings.v1";
async function fixtureRegistry(page: Page) {
  await page.route("**/src/modes/registry.ts", route => route.fulfill({ contentType: "application/javascript", body: `
    import { createTeachingModeRegistry } from '/packages/learning-modes/contracts.ts';
    import { sevenStepRegistration } from '/src/modes/seven-step/register.ts';
    import { testAdaptiveRegistration } from '/tests/e2e/fixtures/adaptive-mode.ts';
    export const teachingModes = createTeachingModeRegistry([sevenStepRegistration, testAdaptiveRegistration], 'seven-step');
  ` }));
}

test("production has two registered modes and keeps one device-wide selection across children and reloads", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); const before = await snapshot(page);
  await parentSpace(page); await navigate(page, "设置");
  await expect(page.getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  await switchMode(page, "课文闯关");
  await page.getByRole("button", { name: "管理孩子档案", exact: true }).click();
  await page.locator(".frame-list-row").filter({ hasText: "旧档案乙" }).getByRole("button", { name: "切换档案" }).click();
  await navigate(page, "设置");
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
  const after = await snapshot(page); expect(after.courses).toEqual(before.courses); expect(after.events).toEqual(before.events); expect(after.runs).toEqual(before.runs);
  await page.reload(); await parentSpace(page); await navigate(page, "设置");
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
});

test("material-only course selection survives reload and never falls back to another course", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("未准备的教材");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click(); await navigate(page, "课程");
  await page.locator(".frame-course-entry").filter({ hasText: "未准备的教材" }).click();
  await expect(page.locator(".course-mode-notice")).toContainText("未准备的教材");
  await page.reload(); await expect(page.locator(".course-mode-notice")).toContainText("未准备的教材");
  await expect(page.locator(".stage-row")).toHaveCount(0);
});

test("unknown saved mode keeps the application usable and requires parent access to recover", async ({ page }) => {
  await seedApplication(page, { mode: "not-installed" }); await page.goto("/");
  await expect(page.getByRole("heading", { name: "学习模式暂时无法加载", exact: true })).toBeVisible();
  await expect(page.locator(".seven-step-mode")).toHaveCount(0);
  await navigate(page, "课程"); await expect(page.locator(".frame-course-entry")).toHaveCount(2);
  await parentSpace(page); await navigate(page, "设置");
  await page.getByRole("radio", { name: /七步/ }).click();
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".stage-list")).toBeVisible();
});

test("a third plugin uses the same frame and its own generation and review without stage assumptions", async ({ page }) => {
  await seedApplication(page); await fixtureRegistry(page); await page.goto("/"); const before = await snapshot(page);
  await parentSpace(page); await navigate(page, "设置");
  await page.getByRole("radio", { name: /测试自适应模式/ }).click();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".test-adaptive-experience")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("button")).toHaveText(["学习", "课程", "记录"]);
  await page.locator(".course-mode-notice").getByRole("button").click(); await adult(page);
  await page.getByRole("button", { name: "模拟生成内容" }).click();
  await page.getByRole("button", { name: "审核并开放测试内容" }).click();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.getByText("本课已审核，可以开始测试学习。")).toBeVisible();
  await page.reload(); await expect(page.getByText("本课已审核，可以开始测试学习。")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test("a failed global selection save leaves the outgoing plugin and all old snapshots intact", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); const before = await snapshot(page);
  await parentSpace(page); await navigate(page, "设置");
  const original = await page.evaluate(key => sessionStorage.getItem(key), modeKey);
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  await page.getByRole("radio", { name: /课文闯关/ }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(key => sessionStorage.getItem(key), modeKey)).toBe(original);
  expect(await snapshot(page)).toEqual(before);
});

test("unsaved material prevents navigation and mode changes until retry succeeds, preserving old progress", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); const before = await snapshot(page);
  await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("切换前的教材草稿");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.evaluate(() => { (window as any).__saveFailure = true; }); await navigate(page, "设置", false);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("切换前的教材草稿");
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__saveFailure = false; }); await navigate(page, "设置");
  await expect(page.getByRole("radiogroup")).toBeVisible();
  await switchMode(page, "课文闯关"); await switchMode(page, "七步");
  const after = await snapshot(page);
  expect(after.courses.filter((item: any) => item.title === "切换前的教材草稿")).toHaveLength(1);
  expect(after.courses[0]).toEqual(before.courses[0]); expect(after.events).toEqual(before.events); expect(after.runs).toEqual(before.runs);
});
