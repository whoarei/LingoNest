import { test, expect, type Page } from "@playwright/test";

async function onboard(page: Page) {
  await page.goto("/");
  await page.getByLabel("先给自己起个昵称").fill("小树");
  await page.getByRole("button", { name: "建立我的小窝" }).click();
  await expect(page.getByRole("heading", { name: /你好，小树/ })).toBeVisible();
  await page.getByRole("button", { name: "先来认识这篇课文" }).click();
  await expect(
    page.getByText(
      "Look. We need new players for our basketball team. Who will join us?",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认课文，准备学习" }).click();
  await page.getByRole("button", { name: "回到学习路线", exact: true }).click();
}

test("learner can confirm a course, complete comprehension, resume and keep hinted spelling out of mastery", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await onboard(page);
  await page.screenshot({
    path: "artifacts/screenshots/home-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "继续读懂故事" }).click();
  for (const option of [
    "Chen Hai",
    "ping-pong",
    "更多打乒乓球的技巧",
    "放学后",
    "不擅长",
    "Yes, I will.",
  ]) {
    await page.locator(".choice-option").filter({ hasText: option }).click();
    await page.getByRole("button", { name: "提交答案", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "做到了，继续保持！" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^(下一题|完成这一轮)$/ }).click();
  }
  await page.getByRole("button", { name: "回到学习路线", exact: true }).click();
  await expect(page.locator(".stage-row").first()).toContainText("已验证");
  await page.getByRole("button", { name: "继续认识单词" }).click();
  await page.getByRole("button", { name: "给我一点提示" }).click();
  await expect(page.getByText("用了提示，这次作为练习记录。")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "继续认识单词" }).click();
  await expect(page.getByText("用了提示，这次作为练习记录。")).toBeVisible();
  await page.getByLabel("写出这个单词").fill("basketball");
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "做到了，继续保持！" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/practice-mobile.png",
    fullPage: true,
  });
  await page.reload();
  const state = await page.evaluate(() =>
    JSON.parse(JSON.parse(localStorage.getItem("lingonest.local.v1")!).payload),
  );
  const attempts = state.events.filter(
    (event: any) => event.type === "attempt",
  );
  expect(attempts).toHaveLength(7);
  expect(attempts[6].attempt.hintLevel).toBe(1);
  expect(exceptions).toEqual([]);
});

test("desktop layout and a second learner remain independent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await onboard(page);
  await page.screenshot({
    path: "artifacts/screenshots/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("新档案昵称").fill("小芽");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByRole("heading", { name: /你好，小芽/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "先来认识这篇课文" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator(".learner-option").filter({ hasText: "小树" }).click();
  await expect(
    page.getByRole("button", { name: "继续读懂故事" }),
  ).toBeVisible();
});

test("top-left icon toggles parent space while speech configuration stays in settings", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "成长", exact: true }).click();
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "家长空间", exact: true })).toBeVisible();
  await expect(page.locator(".speech-settings")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "进入家长空间", exact: true })).toBeDisabled();
  await page.getByLabel("7加5的答案").fill("12");
  await page.getByRole("button", { name: "进入家长空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "目前没有等待确认的录音" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/parent-space-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "切换到学习空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "看见自己的成长" })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator(".speech-settings")).toBeVisible();
  await expect(page.getByLabel("朗读方式")).toBeVisible();
  await expect(page.locator(".parent-space")).toHaveCount(0);
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
  await page.getByRole("button", { name: "小窝", exact: true }).click();
  await page.getByRole("button", { name: "进入家长空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "家长空间", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "artifacts/screenshots/parent-space-desktop.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("switching to parent space during practice requires confirmation and preserves the run", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "继续读懂故事" }).click();
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "继续练习", exact: true }).click();
  await expect(page.locator(".practice-page")).toBeVisible();
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await page.getByRole("button", { name: "保存进度并切换", exact: true }).click();
  await expect(page.getByRole("heading", { name: "家长空间", exact: true })).toBeVisible();
  const state = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("lingonest.local.v1")!).payload));
  expect(state.events.filter((event: any) => event.type === "attempt")).toHaveLength(0);
  await page.getByRole("button", { name: "切换到学习空间", exact: true }).click();
  await page.getByRole("button", { name: "继续读懂故事" }).click();
  await expect(page.locator(".practice-page")).toBeVisible();
});

test("corrupt local data is surfaced and preserved", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("lingonest.local.v1", "{bad-json"),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("无法读取学习记录");
  expect(
    await page.evaluate(() => localStorage.getItem("lingonest.local.v1")),
  ).toBe("{bad-json");
});
