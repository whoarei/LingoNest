import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.route("**/src/native.ts", async (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: readFileSync(
        new URL("./fixtures/speech-native.js", import.meta.url),
        "utf8",
      ),
    }),
  );
  await page.route("**/src/platform/content.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: readFileSync(
        new URL("./fixtures/course-content.js", import.meta.url),
        "utf8",
      ),
    }),
  );
  await page.goto("/");
  await page.getByLabel("先给自己起个昵称").fill("语音测试");
  await page.getByRole("button", { name: "建立我的小窝" }).click();
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
}
async function courses(page: Page) {
  // The registered mode experience is lazy-loaded after a WebView reload.
  await expect(page.locator(".brand-symbol")).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "切换到家长空间", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "切换到家长空间", exact: true })
      .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await page
    .locator(".course-list button")
    .filter({ hasText: "一起加入运动队" })
    .click();
}
async function generate(page: Page) {
  await page
    .getByRole("button", { name: "生成 / 继续整课音频", exact: true })
    .click();
  if (await page.getByLabel("7加5的答案").count()) {
    await page.getByLabel("7加5的答案").fill("12");
    await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  }
}

test("fresh course is empty and voice/speed preview does not create permanent course audio", async ({
  page,
}) => {
  await fixture(page);
  await settings(page);
  await expect(page.locator(".course-audio-panel")).toHaveCount(0);
  await page.getByLabel("朗读方式").selectOption("ai");
  await page.getByRole("button", { name: "小米 MiMo 配置" }).click();
  await page.getByLabel("API Key", { exact: true }).fill("fake-browser-key");
  await page.getByRole("button", { name: "0.75×", exact: true }).click();
  await page.getByRole("button", { name: "保存并试听" }).click();
  await expect(
    page.getByText("试听完成。生成整课后才会采用这套新音色。"),
  ).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(1);
  await page.getByRole("button", { name: "1.25×", exact: true }).click();
  await page.getByRole("button", { name: "保存并试听" }).click();
  await expect(
    page.getByText("试听完成。生成整课后才会采用这套新音色。"),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(1);
  await page.getByLabel("音色", { exact: true }).selectOption("Milo");
  await page.getByRole("button", { name: "保存并试听" }).click();
  await expect(
    page.getByText("试听完成。生成整课后才会采用这套新音色。"),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(2);
  await courses(page);
  await expect(page.locator(".course-audio-panel")).toContainText("0 / 44");
  await page.screenshot({
    path: "artifacts/screenshots/empty-course-audio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("explicit whole-course generation survives cache cleanup/key removal and learning never synthesizes", async ({
  page,
}) => {
  await fixture(page);
  await settings(page);
  await page.getByLabel("朗读方式").selectOption("ai");
  await page.getByRole("button", { name: "小米 MiMo 配置" }).click();
  await page.getByLabel("API Key", { exact: true }).fill("fake-browser-key");
  await page.getByLabel("音色", { exact: true }).selectOption("Milo");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await courses(page);
  await generate(page);
  await expect(
    page.getByText("整课音频已保存为课程资源，可以反复离线学习。"),
  ).toBeVisible();
  await expect(page.locator(".course-audio-panel")).toContainText("Milo");
  const before = await page.evaluate(() => (window as any).__speechRequests);
  expect(before).toBe(44);
  await page.evaluate(() => {
    (window as any).__speechOffline = true;
  });
  await settings(page);
  await page.getByRole("button", { name: "清理试听缓存" }).click();
  await page
    .getByRole("button", { name: "移除 API 配置", exact: true })
    .click();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(page.getByText("已移除 API 配置。")).toBeVisible();
  await courses(page);
  await expect(page.locator(".course-audio-panel")).toContainText("Milo");
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课文", exact: true }).click();
  await page
    .getByRole("button", { name: "朗读 Wang Tao 的这句话", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => page.evaluate(() => (window as any).__coursePlays))
    .toBe(1);
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(
    before,
  );
});

test("pause, reload and continue only missing course audio; delete resets course without losing settings or learner", async ({
  page,
}) => {
  await fixture(page);
  await settings(page);
  await page.getByLabel("朗读方式").selectOption("ai");
  await page.getByRole("button", { name: "小米 MiMo 配置" }).click();
  await page.getByLabel("API Key", { exact: true }).fill("fake-browser-key");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await courses(page);
  await page.evaluate(() => {
    (window as any).__speechDelay = 50;
  });
  await generate(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).__speechRequests))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停生成", exact: true }).click();
  await expect(
    page.getByText("生成已暂停，已完成部分保留，下次可以继续。"),
  ).toBeVisible();
  const partial = await page.evaluate(() => (window as any).__speechRequests);
  expect(partial).toBeLessThan(44);
  await page.reload();
  await courses(page);
  await expect(page.locator(".course-audio-panel")).toContainText(
    partial + " / 44",
  );
  await generate(page);
  await expect(
    page.getByText("整课音频已保存为课程资源，可以反复离线学习。"),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(44);
  await page.getByRole("button", { name: "删除本课音频", exact: true }).click();
  await page.getByRole("button", { name: "确认删除本课音频" }).click();
  await expect(page.locator(".course-audio-panel")).toContainText("0 / 44");
  await settings(page);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "placeholder",
    "已保存；留空保留当前 Key",
  );
  await expect(page.locator(".profile-chip")).toContainText("语音测试");
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(44);
});
