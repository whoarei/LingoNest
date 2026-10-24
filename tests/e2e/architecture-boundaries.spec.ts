import { expect, test } from "@playwright/test";
import { adult, manageCourse, navigate, parentSpace, passageSnapshot, seedApplication, snapshot } from "./fixtures/application";
import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";

test("shared material editing invalidates teaching drafts and both plugins reopen the new source", async ({ page }) => {
  const updatedSource = starterRecord.sourceText + "\nAlice: Our updated material.";
  await seedApplication(page, { mode: "passage-path" }); await page.goto("/");
  await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("边界测试教材");
  await page.getByLabel("文章或课文原文", { exact: true }).fill(starterRecord.sourceText);
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await manageCourse(page, "边界测试教材", "七步");
  await page.getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。").check();
  await page.getByRole("button", { name: "确认原文，整理重点词汇", exact: true }).click(); await adult(page);
  await expect(page.getByRole("heading", { name: "整理并确认重点词汇", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑共同教材与词汇表图片", exact: true }).click();
  await page.getByLabel("文章或课文原文", { exact: true }).fill(updatedSource);
  await page.getByRole("button", { name: "选择词汇表图片", exact: true }).click();
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect(page.getByText("教材已保存。", { exact: true })).toBeVisible();
  await manageCourse(page, "边界测试教材", "七步");
  await expect(page.getByText(/Alice: Our updated material\./)).toBeVisible();
  await expect(page.getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。")).not.toBeChecked();
  const saved = await snapshot(page), material = saved.courses.find((item: any) => item.title === "边界测试教材");
  expect(material).toMatchObject({ sourceText: updatedSource, status: "source", package: null });
  expect(material.vocabularyImages).toHaveLength(1);
  await navigate(page, "设置");
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
  await manageCourse(page, "边界测试教材", "课文闯关");
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  expect((await passageSnapshot(page)).candidates?.find(item => item.package.courseId === material.id)?.package.source.turns.at(-1)?.text).toBe("Our updated material.");
});

test("parent navigation requested by an inactive plugin retains the requesting mode and course", async ({ page }) => {
  await seedApplication(page);
  await page.route("**/src/modes/registry.ts", route => route.fulfill({ contentType: "application/javascript", body: `
    import { createTeachingModeRegistry } from '/packages/learning-modes/contracts.ts';
    import { sevenStepRegistration } from '/src/modes/seven-step/register.ts';
    import { testAdaptiveRegistration } from '/tests/e2e/fixtures/adaptive-mode.ts';
    export const teachingModes = createTeachingModeRegistry([sevenStepRegistration, testAdaptiveRegistration], 'seven-step');
  ` }));
  await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  await page.locator(".frame-course-entry").filter({ hasText: starterRecord.title }).click();
  await page.locator(".frame-list-row").filter({ hasText: "测试自适应模式" }).getByRole("button", { name: "准备／查看内容", exact: true }).click();
  await expect(page.locator(".test-adaptive-experience")).toContainText(starterRecord.title);
  await page.getByRole("button", { name: "重新打开本模式准备", exact: true }).click();
  await expect(page.locator(".test-adaptive-experience")).toBeVisible();
  await expect(page.locator(".test-adaptive-experience")).toContainText(starterRecord.title);
  await navigate(page, "设置");
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
});

test("an unreadable inactive mode preserves public navigation, settings, and source bytes", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page);
  await navigate(page, "课程"); await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("未发布教材");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect(page.getByText("教材已保存。", { exact: true })).toBeVisible();
  const broken = JSON.stringify({ revision: 99, payload: '{"formatVersion":999}' });
  await page.evaluate(value => sessionStorage.setItem("native-document:lingonest.passage-path.v2", value), broken);
  await page.reload(); await expect(page.locator(".stage-list")).toBeVisible();
  await parentSpace(page); await navigate(page, "课程");
  await expect(page.locator(".frame-course-entry").filter({ hasText: "未发布教材" })).toBeVisible();
  await navigate(page, "设置"); await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("native-document:lingonest.passage-path.v2"))).toBe(broken);
});

test("retrying an initial mode read failure recovers without a page reload or rewriting learning data", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true });
  await page.addInitScript(() => { (window as any).__modeReadFailure = true; });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("模拟模式读取暂时失败");
  const original = await page.evaluate(() => sessionStorage.getItem("native-document:lingonest.passage-path.v2"));
  await page.evaluate(() => { (window as any).__modeReadFailure = false; });
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("native-document:lingonest.passage-path.v2"))).toBe(original);
});
