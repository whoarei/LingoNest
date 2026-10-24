import { expect, test } from "@playwright/test";
import { navigate, parentSpace, seedApplication } from "./fixtures/application";

test("long course titles and child names remain readable at narrow widths", async ({ page }) => {
  await seedApplication(page);
  await page.addInitScript(() => {
    const fixture = JSON.parse(sessionStorage.getItem("speech-native-fixture")!), data = JSON.parse(fixture.payload);
    data.learners[0].nickname = "学习小伙伴的十六个字昵称好长好长".slice(0, 16);
    data.courses[0].title = "A".repeat(100);
    data.courses[0].package.course.title = data.courses[0].title;
    fixture.payload = JSON.stringify(data); sessionStorage.setItem("speech-native-fixture", JSON.stringify(fixture));
  });
  await page.goto("/");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 640 });
    await expect(page.locator(".stage-list")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/review-20261024/long-title-${width}.png`, fullPage: true });
    await navigate(page, "课程");
    const title = page.locator(".frame-course-entry strong").filter({ hasText: "A".repeat(100) });
    expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await navigate(page, "学习");
  }
});

test("parent and exit dialogs contain keyboard focus, close with Escape and restore their trigger", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  const trigger = page.getByRole("button", { name: "家长空间", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "请家长确认", exact: true });
  await expect(page.getByLabel("7加5的答案")).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "取消操作" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByLabel("7加5的答案")).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const exit = page.getByRole("button", { name: "保存并退出", exact: true }); await exit.click();
  await expect(page.getByRole("button", { name: "继续练习", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(exit).toBeFocused();
});

test("a parent dialog remains fully reachable when the mobile keyboard shortens the viewport", async ({ page }) => {
  await seedApplication(page); await page.goto("/");
  await page.getByRole("button", { name: "家长空间", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 280 });
  const dialog = page.getByRole("dialog", { name: "请家长确认", exact: true });
  const top = await dialog.boundingBox(); expect(top!.y).toBeGreaterThanOrEqual(0);
  await page.getByLabel("7加5的答案").fill("12");
  await dialog.getByRole("button", { name: "确认并继续" }).click();
  await expect(page.getByRole("navigation", { name: "家长导航" })).toBeVisible();
});

test("editing after a material save shows unsaved changes and image previews support keyboard return", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("A new lesson");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect(page.getByRole("status", { exact: true }).filter({ hasText: "教材已保存。" })).toBeVisible();
  await page.getByLabel("课程标题", { exact: true }).fill("Another lesson");
  await expect(page.getByRole("status").filter({ hasText: "有未保存的修改" })).toBeVisible();
  await expect(page.getByText("教材已保存。", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  const trigger = page.getByRole("button", { name: "放大课文原图 1", exact: true }); await trigger.click();
  await expect(page.getByRole("button", { name: "关闭原图", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused();
});
