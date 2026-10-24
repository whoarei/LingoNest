import { expect, test } from "@playwright/test";
import { navigate, parentSpace, seedApplication } from "./fixtures/application";

test("record details cannot survive a change to another child in durable public selection", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page); await navigate(page, "记录");
  await page.getByRole("button", { name: "查看作答", exact: true }).click();
  await expect(page.locator(".frame-record-detail")).toContainText("family");
  await page.evaluate(() => {
    const key = "native-document:lingonest.catalog.v1", document = JSON.parse(sessionStorage.getItem(key)!);
    const value = JSON.parse(document.payload); value.activeLearnerId = "legacy-b";
    sessionStorage.setItem(key, JSON.stringify({ revision: document.revision + 1, payload: JSON.stringify(value) }));
  });
  await navigate(page, "设置");
  await page.locator(".frame-page-heading").getByRole("button", { name: /返回(家长空间|作答详情|学习记录)/ }).click();
  await expect(page.getByRole("heading", { name: "每一步，都记得", exact: true })).toBeVisible();
  await expect(page.locator(".frame-record-detail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(0);
});

test("an interrupted purge refreshes public lists and exposes mode-independent retry status", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path" }); await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  await page.locator(".frame-course-entry").filter({ hasText: "My Family" }).click();
  await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await page.getByRole("button", { name: "彻底删除", exact: true }).click();
  await page.getByLabel("输入名称确认").fill("My Family");
  await page.evaluate(() => { (window as any).__saveFailure = true; });
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模拟保存失败");
  await page.getByRole("button", { name: "保留数据", exact: true }).click();
  await expect(page.locator(".frame-course-entry").filter({ hasText: "My Family" })).toHaveCount(0);
  await navigate(page, "记录");
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(0);
  await navigate(page, "设置");
  await expect(page.getByText(/1 项删除任务尚未完成/)).toBeVisible();
  await page.evaluate(() => { (window as any).__saveFailure = false; });
  await page.getByRole("button", { name: "重试本机资源清理", exact: true }).click();
  await expect(page.getByText(/删除任务尚未完成/)).toHaveCount(0);
  const value = await page.evaluate(() => JSON.parse(JSON.parse(sessionStorage.getItem("native-document:lingonest.deletions.v2")!).payload));
  expect(value.plans).toEqual([]);
});
