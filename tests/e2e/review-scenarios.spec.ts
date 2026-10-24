import { expect, test } from "@playwright/test";
import { adult, navigate, parentSpace, passageSnapshot, seedApplication, snapshot } from "./fixtures/application";

test("a parent settings detour keeps an active passage question and releases a retired session", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const question = await page.locator(".passage-practice h1").innerText();
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  const choices = page.locator(".passage-choices button");
  if (await choices.count()) await choices.first().click();
  else if (await page.getByLabel("填写答案", { exact: true }).count()) await page.getByLabel("填写答案", { exact: true }).fill("my pending answer");
  else await page.locator(".passage-tokens button").first().click();
  await expect(page.getByRole("alert")).toContainText("模拟模式设置保存失败");
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("button", { name: "请家长处理", exact: true }).click(); await adult(page);
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  const saved = (await passageSnapshot(page)).sessions[0]!;
  expect(saved.input.text || saved.input.selectedIds.length).toBeTruthy();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).last().click();
  await expect(page.locator(".passage-practice h1")).toHaveText(question);
  expect((await passageSnapshot(page)).sessions[0]).toEqual(saved);
  // A newly published source used by cross-course review can retire this run
  // while its own course revision stays unchanged.
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  await page.locator(".passage-choices button").last().click();
  await expect(page.getByRole("alert")).toContainText("模拟模式设置保存失败");
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("button", { name: "请家长处理", exact: true }).click(); await adult(page);
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const key = "native-document:lingonest.passage-path.v2", document = JSON.parse(sessionStorage.getItem(key)!);
    const data = JSON.parse(document.payload); data.sessions[0].status = "retired";
    document.payload = JSON.stringify(data); document.revision++;
    sessionStorage.setItem(key, JSON.stringify(document));
  });
  await page.getByRole("button", { name: "返回学习空间", exact: true }).last().click();
  await expect(page.locator(".passage-hero")).toBeVisible();
  expect((await passageSnapshot(page)).sessions[0]!.status).toBe("retired");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice")).toBeVisible();
  expect((await passageSnapshot(page)).sessions).toHaveLength(2);
});

test("leaving an untouched new material returns to the list without creating a blank course", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  const before = await snapshot(page);
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新建教材", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__nativeBack());
  await expect(page.getByRole("heading", { name: "课程管理", exact: true })).toBeVisible();
  expect((await snapshot(page)).courses).toEqual(before.courses);
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByRole("button", { name: "返回课程列表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "课程管理", exact: true })).toBeVisible();
  expect((await snapshot(page)).courses).toEqual(before.courses);
});
