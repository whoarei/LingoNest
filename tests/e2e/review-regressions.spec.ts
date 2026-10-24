import { expect, test } from "@playwright/test";
import { navigate, parentSpace, seedApplication, snapshot } from "./fixtures/application";

test("archived course filters stay in the parent space and reset after restoring the last course", async ({ page }) => {
  await seedApplication(page); await page.goto("/");
  await parentSpace(page); await navigate(page, "课程");
  await page.locator(".frame-course-entry").filter({ hasText: "My Family" }).click();
  await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await expect.poll(async () => !!(await snapshot(page)).courses[0].deletedAt).toBe(true);
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await navigate(page, "课程");
  await expect(page.locator(".frame-course-entry")).toHaveCount(1);
  await expect(page.locator(".frame-course-entry")).toContainText("一起加入运动队");
  await expect(page.getByRole("button", { name: "阅读教材", exact: true })).toBeVisible();
  await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await page.getByRole("button", { name: "恢复课程", exact: true }).click();
  await expect(page.getByRole("button", { name: "已删除（1）", exact: true })).toHaveCount(0);
  await expect(page.locator(".frame-course-entry")).toHaveCount(2);
});

test("native back from child material reading returns to the course list", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await navigate(page, "课程");
  await page.locator(".swipe-course-row").filter({ hasText: "一起加入运动队" }).getByRole("button", { name: "阅读教材", exact: true }).click();
  await expect(page.locator(".frame-material-turn").first()).toBeVisible();
  await page.evaluate(() => (window as any).__nativeBack());
  await expect(page.getByRole("heading", { name: "我的课程", exact: true })).toBeVisible();
});

test("learning history exposes older records and resets its page when filters change", async ({ page }) => {
  await seedApplication(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("long-history-seeded")) return;
    const fixture = JSON.parse(sessionStorage.getItem("speech-native-fixture")!);
    const data = JSON.parse(fixture.payload), original = data.events.find((event: any) => event.type === "attempt");
    data.events = Array.from({ length: 105 }, (_, index) => {
      const at = new Date(Date.UTC(2026, 9, 14, 2, index)).toISOString();
      return { ...original, id: `history-event-${index}`, at,
        attempt: { ...original.attempt, id: `history-attempt-${index}`, clientEventId: `history-client-${index}`, submittedAt: at } };
    });
    fixture.payload = JSON.stringify(data); sessionStorage.setItem("speech-native-fixture", JSON.stringify(fixture));
    sessionStorage.setItem("long-history-seeded", "1");
  });
  await page.goto("/"); await navigate(page, "记录");
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(50);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(5);
  await page.getByRole("button", { name: "查看作答", exact: true }).last().click();
  await expect(page.locator(".frame-record-detail")).toContainText("10/14");
  await page.getByRole("button", { name: "返回学习记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(5);
  await page.getByLabel("学习模式", { exact: true }).selectOption("passage-path");
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(0);
  await page.getByLabel("学习模式", { exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "查看作答", exact: true })).toHaveCount(50);
});
