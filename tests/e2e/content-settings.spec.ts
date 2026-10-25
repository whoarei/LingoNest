import { expect, test, type Page } from "@playwright/test";
import { navigate, parentSpace, seedApplication } from "./fixtures/application";

async function settings(page: Page) {
  await seedApplication(page);
  await page.goto("/");
  await parentSpace(page);
  await navigate(page, "设置");
}

test("saves and tests each content model with the latest inputs and retained keys", async ({ page }) => {
  await settings(page);
  await page.getByLabel("课程生成模型", { exact: true }).fill("new-text-model");
  await page.getByLabel("课程生成 API Key", { exact: true }).fill("fake-test-key");
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(page.getByText("课程生成测试通过，配置已保存。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("课程生成 API Key", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "保存并测试文字识别", exact: true }).click();
  await expect(page.getByText("文字识别测试通过，配置已保存。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__contentTests)).toEqual([
    { kind: "generation", baseUrl: "https://content.example.com/v1", model: "new-text-model", hasKey: true },
    { kind: "recognition", baseUrl: "https://content.example.com/v1", model: "test-vision", hasKey: true },
  ]);
  expect(await page.evaluate(() => JSON.stringify((window as any).__contentTests))).not.toContain("fake-test-key");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".content-settings").screenshot({ path: "artifacts/screenshots/content-settings-test-mobile.png" });
});

test("shows actionable failure, retains the saved configuration and permits retry", async ({ page }) => {
  await settings(page);
  await page.evaluate(() => {
    (window as any).__contentTestFailure = "内容服务请求失败（HTTP 401）：API Key 无效或已过期，请重新填写。";
  });
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("课程生成测试失败：内容服务请求失败（HTTP 401）");
  await expect(page.getByRole("alert")).toContainText("配置已保存，可修改后重新测试。");
  await expect(page.getByRole("button", { name: "保存并测试课程生成", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__contentTestFailure = ""; });
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(page.getByText("课程生成测试通过，配置已保存。", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("blocks duplicate actions during testing and cancels when leaving settings", async ({ page }) => {
  await settings(page);
  await page.evaluate(() => { (window as any).__contentTestDelay = 1200; });
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(page.getByRole("button", { name: "测试中…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存并测试文字识别", exact: true })).toBeDisabled();
  await expect(page.getByLabel("课程生成模型", { exact: true })).toBeDisabled();
  await navigate(page, "课程");
  await expect.poll(() => page.evaluate(() => (window as any).__contentCancellations)).toBe(1);
  await page.waitForTimeout(1400);
  await expect(page.getByText("课程生成测试通过，配置已保存。", { exact: true })).toHaveCount(0);
});

test("save only makes no test request and save failure never starts a test", async ({ page }) => {
  await settings(page);
  await page.getByRole("button", { name: "仅保存课程生成配置", exact: true }).click();
  await expect(page.getByText("课程生成配置已保存，尚未测试。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__contentTests || [])).toEqual([]);
  await page.evaluate(() => { (window as any).__contentSaveFailure = "更换服务域名后，请重新填写该服务的 API Key。"; });
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("更换服务域名后，请重新填写");
  expect(await page.evaluate(() => (window as any).__contentTests || [])).toEqual([]);
  await expect(page.getByRole("alert")).not.toContainText("配置已保存");
});

test("eye controls reveal each entered API key independently without submitting and reset after saving", async ({ page }) => {
  await settings(page);
  for (const [field, toggle] of [
    ["文字识别 API Key", "文字识别 API Key"],
    ["课程生成 API Key", "课程生成 API Key"],
    ["API Key", "语音 API Key"],
  ]) {
    const input = page.getByLabel(field!, { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await input.fill("fake-key-for-visual-check");
    await page.getByRole("button", { name: `显示${toggle}`, exact: true }).click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue("fake-key-for-visual-check");
    const hide = page.getByRole("button", { name: `隐藏${toggle}`, exact: true });
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await hide.press("Enter");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue("fake-key-for-visual-check");
  }
  expect(await page.evaluate(() => (window as any).__contentTests || [])).toEqual([]);
  await page.getByRole("button", { name: "显示课程生成 API Key", exact: true }).click();
  await expect(page.getByLabel("文字识别 API Key", { exact: true })).toHaveAttribute("type", "password");
  await page.locator("#content-key-generation").locator("..").screenshot({ path: "artifacts/screenshots/api-key-eye.png" });
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(page.getByLabel("课程生成 API Key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("课程生成 API Key", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "显示课程生成 API Key", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "显示语音 API Key", exact: true }).click();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute("type", "password");
});

test("each card keeps its result beside the fields and edits invalidate a successful test", async ({ page }) => {
  await settings(page);
  const generation = page.getByRole("form", { name: "课程生成", exact: true });
  const recognition = page.getByRole("form", { name: "文字识别", exact: true });
  await expect(generation.locator(".model-config-status")).toHaveText("已保存 · 待测试");
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(generation.locator(".model-config-status")).toHaveText("测试通过");
  await expect(generation.getByRole("status")).toContainText("课程生成测试通过");
  await expect(recognition.getByRole("status")).toHaveCount(0);
  await page.getByLabel("课程生成模型", { exact: true }).fill("edited-text-model");
  await expect(generation.locator(".model-config-status")).toHaveText("待保存");
  await expect(generation.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "仅保存课程生成配置", exact: true }).click();
  await expect(generation.locator(".model-config-status")).toHaveText("已保存 · 待测试");
  await page.evaluate(() => { (window as any).__contentTestFailure = "API Key 无效或已过期，请重新填写。"; });
  await page.getByRole("button", { name: "保存并测试文字识别", exact: true }).click();
  await expect(recognition.locator(".model-config-status")).toHaveText("测试未通过");
  await expect(recognition.getByRole("alert")).toContainText("API Key 无效或已过期");
  await page.evaluate(() => { (window as any).__contentTestFailure = ""; });
  await page.getByRole("button", { name: "保存并测试文字识别", exact: true }).click();
  await expect(recognition.locator(".model-config-status")).toHaveText("测试通过");
  await page.getByRole("button", { name: "保存并测试课程生成", exact: true }).click();
  await expect(generation.locator(".model-config-status")).toHaveText("测试通过");
  for (const width of [320, 640, 1280]) {
    await page.setViewportSize({ width, height: 1100 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const card of [recognition, generation]) {
      const box = (await card.boundingBox())!;
      const action = (await card.getByRole("button", { name: /保存并测试/ }).boundingBox())!;
      const save = (await card.getByRole("button", { name: /仅保存/ }).boundingBox())!;
      expect(action.x).toBeGreaterThanOrEqual(box.x);
      expect(save.x + save.width).toBeLessThanOrEqual(box.x + box.width);
    }
    await page.locator(".content-settings").screenshot({ path: `artifacts/screenshots/model-settings-${width}.png` });
  }
  await page.getByRole("button", { name: "移除文字识别配置", exact: true }).click();
  await page.getByRole("button", { name: "确认移除文字识别配置", exact: true }).click();
  await expect(recognition.locator(".model-config-status")).toHaveText("尚未配置");
});
