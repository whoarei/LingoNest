import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { exercises } from "../../src/course";
import { gradeExercise } from "../../packages/learning-engine/src";
import type { Attempt } from "../../packages/learning-engine/src/model";

async function fixture(page: Page, seed = false) {
  await page.route("**/src/native.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: readFileSync(
        new URL("./fixtures/speech-native.js", import.meta.url),
        "utf8",
      ),
    }),
  );
  await page.route("**/src/content.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: readFileSync(
        new URL("./fixtures/course-content.js", import.meta.url),
        "utf8",
      ),
    }),
  );
  await page.goto("/");
  await page.getByLabel("先给自己起个昵称").fill("家长测试");
  await page.getByRole("button", { name: "建立我的小窝" }).click();
  await expect(
    page.getByRole("heading", { name: /你好，家长测试/ }),
  ).toBeVisible();
  if (seed) {
    const oral = exercises.find((item) => item.kind === "oral")!;
    const spelling = exercises.find((item) => item.kind === "spelling")!;
    const time = new Date().toISOString();
    const data = [oral, spelling].map((exercise, index) => {
      const response = {
        answer: index ? exercise.acceptedAnswers[0]! : "",
        selectedIds: [],
        recordingPath: index ? null : "recordings/test/one.m4a",
      };
      return {
        id: index ? "hinted-one" : "oral-one",
        clientEventId: `client-${index}`,
        learnerId: "",
        sessionId: `session-${index}`,
        exerciseId: exercise.id,
        ...response,
        hintLevel: index ? 1 : 0,
        submittedAt: time,
        localDate: time.slice(0, 10),
        timezone: "UTC",
        clockStatus: "normal",
        firstTest: true,
        grade: gradeExercise(exercise, response),
      } as Attempt;
    });
    await page.evaluate((attempts) => {
      const fixture = JSON.parse(
        sessionStorage.getItem("speech-native-fixture")!,
      );
      const state = JSON.parse(fixture.payload);
      for (const attempt of attempts) {
        attempt.learnerId = state.activeLearnerId;
        state.events.push({
          id: `event-${attempt.id}`,
          type: "attempt",
          learnerId: attempt.learnerId,
          at: attempt.submittedAt,
          attempt,
        });
      }
      fixture.payload = JSON.stringify(state);
      sessionStorage.setItem("speech-native-fixture", JSON.stringify(fixture));
    }, data);
    await page.reload();
  }
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
}
async function adult(page: Page) {
  await page.getByLabel("7加5的答案").fill("12");
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
}
async function snapshot(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      JSON.parse(sessionStorage.getItem("speech-native-fixture")!).payload,
    ),
  );
}

test("parent reports distinguish hinted practice and pending audio, and keep context through settings", async ({
  page,
}) => {
  await fixture(page, true);
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
  await expect(page.locator(".parent-metrics")).toContainText(
    /达到掌握门槛\s*0/,
  );
  await page.screenshot({
    path: "artifacts/screenshots/parent-overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "报告", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "学习报告", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".parent-target").filter({ hasText: "待家长确认" }),
  ).toHaveCount(1);
  const hinted = page
    .locator(".parent-target")
    .filter({ hasText: "尚无独立测评" });
  await expect(hinted).toHaveCount(1);
  await hinted.locator("summary").click();
  await expect(hinted).toContainText("提示练习");
  await expect(hinted).toContainText("孩子的作答");
  const before = await snapshot(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "切换到学习空间", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "学习报告", exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).events).toEqual(before.events);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "artifacts/screenshots/parent-report-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "先读懂，再开口" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo({ top: 500, behavior: "instant" });
    (document.querySelector(".brand-symbol") as HTMLButtonElement).click();
  });
  await expect(
    page.getByRole("heading", { name: "家长空间", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "先读懂，再开口" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500);
});

test("oral confirmation requires completed playback, supports correction and persists its audit trail", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  const card = page.locator('.parent-review-card[data-attempt-id="oral-one"]');
  await expect(
    card.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).__recordingDelay = 250;
  });
  await card.getByRole("button", { name: "先回听录音" }).click();
  await expect(
    card.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeEnabled();
  await card.getByRole("button", { name: "确认通过", exact: true }).click();
  await adult(page);
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "已确认 1", exact: true }).click();
  await expect(card).toContainText("本次通过");
  await expect(
    card.getByRole("button", { name: "更正为还需练习", exact: true }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "先回听录音" }).click();
  await card
    .getByRole("button", { name: "更正为还需练习", exact: true })
    .click();
  await expect(card).toContainText("还需练习");
  await card.locator("summary").click();
  await expect(card).toContainText("家长确认通过");
  await expect(card).toContainText("家长确认还需练习");
  const state = await snapshot(page);
  expect(
    state.events
      .filter((event: any) => event.type === "review")
      .map((event: any) => event.expectedRevision),
  ).toEqual([0, 1]);
  await page.screenshot({
    path: "artifacts/screenshots/parent-confirm-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "已确认 1", exact: true }).click();
  await expect(card).toContainText("查看 2 次确认记录");
  await expect(
    card.getByRole("button", { name: "更正为通过", exact: true }),
  ).toBeDisabled();
});

test("interrupted or missing audio never enables review and tab changes cancel playback quietly", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__recordingDelay = 500;
  });
  await page.getByRole("button", { name: "先回听录音" }).click();
  await page.getByRole("button", { name: "停止回听", exact: true }).click();
  await page.waitForTimeout(550);
  await expect(
    page.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "先回听录音" }).click();
  await page.getByRole("button", { name: "报告", exact: true }).click();
  await page.waitForTimeout(550);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__recordingUnavailable = true;
    (window as any).__recordingDelay = 20;
  });
  await page.getByRole("button", { name: "先回听录音" }).click();
  await expect(page.getByRole("alert")).toContainText("录音不存在或已删除");
  await expect(
    page.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeDisabled();
  expect(
    (await snapshot(page)).events.filter(
      (event: any) => event.type === "review",
    ),
  ).toHaveLength(0);
});

test("changing children clears heard recordings and adult confirmation while keeping each child's report independent", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "先回听录音" }).click();
  await expect(
    page.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeEnabled();
  await page.locator(".parent-child-button").click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("新档案昵称").fill("另一位孩子");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await adult(page);
  await page.getByRole("button", { name: "报告", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这项能力还没有作答记录" }),
  ).toBeVisible();
  await expect(page.locator(".parent-target")).toHaveCount(0);
  await page.getByRole("button", { name: "全部学习目标", exact: true }).click();
  await expect(page.locator(".parent-target")).toHaveCount(51);
  await page.locator(".parent-child-button").click();
  await page.locator(".learner-option").filter({ hasText: "家长测试" }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认通过", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "先回听录音" }).click();
  await page.getByRole("button", { name: "确认通过", exact: true }).click();
  await expect(page.getByLabel("7加5的答案")).toBeVisible();
  await page.getByRole("button", { name: "取消操作", exact: true }).click();
  expect(
    (await snapshot(page)).events.filter(
      (event: any) => event.type === "review",
    ),
  ).toHaveLength(0);
});

test("parent can create the first profile, prepare its course, rename and delete it without leaving parent space", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "创建孩子档案", exact: true }).click();
  await page.getByLabel("新档案昵称").fill("小新");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await adult(page);
  await expect(
    page.getByRole("heading", { name: "当前档案 · 小新" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await page
    .locator(".course-list button")
    .filter({ hasText: "一起加入运动队" })
    .click();
  await expect(
    page.getByRole("button", { name: "确认课文，准备学习", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "确认课文，准备学习", exact: true })
    .click();
  await adult(page);
  await expect(page.getByText("本档案已核对", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("朗读方式")).toBeVisible();
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "一起加入运动队", exact: true, level: 1 }),
  ).toBeVisible();
  await page.locator(".parent-child-button").click();
  await page.getByRole("button", { name: "修改昵称", exact: true }).click();
  await page.getByLabel("新的昵称").fill("小新芽");
  await page.getByRole("button", { name: "保存昵称", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前档案 · 小新芽" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除档案", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认删除", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("输入昵称「小新芽」确认").fill("小新芽");
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByLabel("新档案昵称")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "家长导航" }),
  ).toBeVisible();
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
});
