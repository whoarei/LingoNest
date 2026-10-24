import { expect, test } from "@playwright/test";
import { adult, manageCourse, navigate, parentSpace, passageSnapshot, seedApplication, snapshot, switchMode } from "./fixtures/application";
import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";

test("one application frame keeps seeded data, navigation and historical reports through a mode round trip", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await seedApplication(page); await page.goto("/");
  await expect(page.locator(".stage-list")).toBeVisible();
  const original = await snapshot(page);
  const navigation = await page.getByRole("navigation", { name: "主导航" }).innerText();
  await parentSpace(page); await switchMode(page, "课文闯关");
  await expect(page.locator(".seven-step-mode")).toHaveCount(0);
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".course-mode-notice")).toContainText("本课尚未生成");
  expect(await page.getByRole("navigation", { name: "主导航" }).innerText()).toBe(navigation);
  await navigate(page, "记录"); await page.getByRole("button", { name: /七步.*报告/ }).click();
  await expect(page.getByRole("heading", { name: "学习报告", exact: true })).toBeVisible();
  expect((await snapshot(page)).learningCourseIds).toEqual(original.learningCourseIds);
  await parentSpace(page); await switchMode(page, "七步");
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".stage-list")).toBeVisible();
  await page.reload(); await expect(page.locator(".stage-list")).toBeVisible();
  expect(await snapshot(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test("shared material can prepare an inactive plugin without changing the global learning mode", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("Shared Sports");
  await page.getByLabel("文章或课文原文", { exact: true }).fill(starterRecord.sourceText);
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await page.getByRole("button", { name: "返回课程详情", exact: true }).click();
  await page.getByRole("button", { name: "学习模式", exact: true }).click();
  await page.locator(".frame-list-row").filter({ hasText: "七步" }).getByRole("button", { name: "准备／查看内容", exact: true }).click();
  await expect(page.getByRole("heading", { name: "七步学习内容", exact: true })).toBeVisible();
  await page.getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。").check();
  await page.getByRole("button", { name: "确认原文，整理重点词汇", exact: true }).click(); await adult(page);
  await expect(page.getByRole("heading", { name: "整理并确认重点词汇", exact: true })).toBeVisible();
  await navigate(page, "设置");
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
  const saved = await snapshot(page);
  expect(saved.courses.filter((item: any) => item.title === "Shared Sports")).toHaveLength(1);
  expect(saved.courses.find((item: any) => item.title === "Shared Sports").status).toBe("vocabulary");
  await manageCourse(page, "Shared Sports", "课文闯关");
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  expect((await passageSnapshot(page)).candidates).toHaveLength(1);
});

test("failed practice save keeps input and the focus screen; retry and reload recover the same session", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".application-focusbar")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  const choices = page.locator(".passage-choices button");
  if (await choices.count()) await choices.first().click();
  else if (await page.getByLabel("填写答案", { exact: true }).count()) await page.getByLabel("填写答案", { exact: true }).fill("pending answer");
  else await page.locator(".passage-tokens button").first().click();
  await page.getByRole("button", { name: "保存并退出", exact: true }).first().click();
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模拟模式设置保存失败");
  await expect(page.locator(".application-focusbar")).toBeVisible();
  await expect(page.locator(".frame-modal")).toBeVisible();
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续学习", exact: true })).toBeVisible();
  const saved = (await passageSnapshot(page)).sessions[0]!;
  expect(saved.input.text || saved.input.selectedIds.length).toBeTruthy();
  await page.reload(); await page.getByRole("button", { name: "继续学习", exact: true }).click();
  expect((await passageSnapshot(page)).sessions[0]).toEqual(saved);
});

test("plugin failure preserves public navigation, material management and recovery settings", async ({ page }) => {
  await seedApplication(page);
  await page.route("**/src/modes/seven-step/Experience.vue", route => route.fulfill({ contentType: "application/javascript", body: 'throw new Error("fixture plugin unavailable");' }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "学习模式暂时无法加载", exact: true })).toBeVisible();
  await navigate(page, "课程"); await expect(page.locator(".frame-course-entry")).toHaveCount(2);
  await parentSpace(page); await switchMode(page, "课文闯关");
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
});

test("application and both plugin surfaces fit narrow screens and older WebViews", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true, legacyApis: true }); await page.goto("/");
  await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: "artifacts/review-20261024/passage-home-mobile.png", fullPage: true });
  }
  await page.screenshot({ path: "artifacts/application-frame-passage.png", fullPage: true });
  await parentSpace(page); await switchMode(page, "七步");
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".stage-list")).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: "artifacts/review-20261024/seven-home-mobile.png", fullPage: true });
  }
  await page.screenshot({ path: "artifacts/application-frame-seven-step.png", fullPage: true });
});

test("shared material remains readable before a learning mode has prepared its content", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", passage: null, starter: true }); await page.goto("/");
  await expect(page.locator(".course-mode-notice")).toBeVisible();
  const before = await snapshot(page);
  await navigate(page, "课程");
  await page.locator(".swipe-course-row").filter({ hasText: "一起加入运动队" }).getByRole("button", { name: "阅读教材", exact: true }).click();
  await expect(page.locator(".frame-material-turn")).toHaveCount(starterRecord.sourceText.split(/\r?\n/).filter(line => line.trim()).length);
  expect((await snapshot(page)).learningCourseIds).toEqual(before.learningCourseIds);
  expect((await snapshot(page)).events).toEqual(before.events);
});

test("an application with no teaching plugins can still manage children and material without rewriting learning history", async ({ page }) => {
  await seedApplication(page);
  await page.route("**/src/modes/registry.ts", route => route.fulfill({ contentType: "application/javascript", body: "import { createTeachingModeRegistry } from '/packages/learning-modes/contracts.ts'; export const teachingModes = createTeachingModeRegistry([], 'seven-step');" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "学习模式暂时无法加载", exact: true })).toBeVisible();
  const before = await snapshot(page);
  await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("只有教材的课程");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await navigate(page, "设置");
  await expect(page.getByText("尚未接入学习模式。教材、孩子档案和应用设置可以继续管理。", { exact: true })).toBeVisible();
  const after = await snapshot(page);
  expect(after.courses).toHaveLength(before.courses.length + 1);
  expect(after.events).toEqual(before.events); expect(after.runs).toEqual(before.runs);
});

test("settings opened from an unavailable plugin restore the child space after recovery", async ({ page }) => {
  await seedApplication(page, { mode: "not-installed" }); await page.goto("/");
  const before = await snapshot(page);
  await page.getByRole("button", { name: "请家长处理", exact: true }).click(); await adult(page);
  await page.getByRole("radio", { name: /七步/ }).click();
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  await page.locator(".frame-page-heading").getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "家长导航" })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
