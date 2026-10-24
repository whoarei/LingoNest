import { expect, test } from "@playwright/test";
import { adult, manageCourse, navigate, parentSpace, seedApplication } from "./fixtures/application";
import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";

const catalogKey = "native-document:lingonest.catalog.v1", sevenKey = "native-document:lingonest.seven-step.v1";
test("a corrupt seven-step document leaves passage learning, public profiles and material creation usable", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
  const broken = JSON.stringify({ revision: 99, payload: '{"formatVersion":999}' });
  await page.evaluate(({ key, broken }) => sessionStorage.setItem(key, broken), { key: sevenKey, broken });
  await page.reload(); await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".application-focusbar")).toBeVisible();
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await expect(page.locator(".application-focusbar")).toHaveCount(0);
  await parentSpace(page); await page.getByRole("button", { name: "管理孩子档案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "孩子档案", exact: true })).toBeVisible();
  await navigate(page, "课程"); await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("独立公共教材");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, independent storage.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect(page.getByText("教材已保存。", { exact: true })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), sevenKey)).toBe(broken);
});

test("public material and teaching preparation write separate physical documents", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page);
  const before = await page.evaluate(key => sessionStorage.getItem(key), sevenKey);
  await navigate(page, "课程"); await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("存储边界教材");
  await page.getByLabel("文章或课文原文", { exact: true }).fill(starterRecord.sourceText);
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect(page.getByText("教材已保存。", { exact: true })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), sevenKey)).toBe(before);
  const publicBefore = await page.evaluate(key => sessionStorage.getItem(key), catalogKey);
  await manageCourse(page, "存储边界教材", "七步");
  await page.getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。").check();
  await page.getByRole("button", { name: "确认原文，整理重点词汇", exact: true }).click(); await adult(page);
  await expect(page.getByRole("heading", { name: "整理并确认重点词汇", exact: true })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), catalogKey)).toBe(publicBefore);
  const stored = await page.evaluate(({ catalogKey, sevenKey }) => ({
    catalog: JSON.parse(JSON.parse(sessionStorage.getItem(catalogKey)!).payload),
    seven: JSON.parse(JSON.parse(sessionStorage.getItem(sevenKey)!).payload),
  }), { catalogKey, sevenKey });
  expect(stored.catalog.courses.every((item: any) => !("package" in item) && !("status" in item) && !("vocabulary" in item))).toBe(true);
  expect(stored.seven).not.toHaveProperty("learners"); expect(stored.seven).not.toHaveProperty("activeLearnerId"); expect(stored.seven).not.toHaveProperty("learningCourseIds");
});
