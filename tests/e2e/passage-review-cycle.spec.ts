import { expect, test, type Page } from "@playwright/test";
import { manageCourse, navigate, parentSpace, passageSnapshot, seedApplication } from "./fixtures/application";
import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";

async function answerCurrent(page: Page) {
  const state = await passageSnapshot(page), session = state.sessions[state.sessions.length - 1]!, item = session.queue[session.index]!;
  const question = state.packages.find(pkg => pkg.courseId === item.courseId && pkg.revision === item.revision)!.questions.find(question => question.id === item.questionId)!;
  if (question.kind === "cloze") {
    const input = page.getByLabel("填写答案", { exact: true }); await expect(input).toHaveAttribute("maxlength", "2000");
    await input.fill(question.answers[0]!); await expect(input).toBeFocused();
  } else if (question.kind === "order") {
    for (const id of question.correctTokenIds) await page.locator(".passage-tokens").getByRole("button", { name: question.tokens.find(token => token.id === id)!.text, exact: true }).click();
  } else if ("options" in question) await page.locator(".passage-choices").getByRole("button", { name: question.options.find(option => option.id === question.correctOptionId)!.text, exact: true }).click();
  await page.getByRole("button", { name: "检查答案", exact: true }).click();
}

test("a short passage round moves keyboard focus through feedback, the next question and its summary", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice h1")).toBeVisible();
  const run = (await passageSnapshot(page)).sessions[0]!;
  await page.locator(".application-focusbar").getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await page.getByRole("button", { name: "继续学习", exact: true }).click();
  for (let index = 0; index < run.baseCount; index++) {
    await expect(page.locator(".passage-practice h1")).toBeFocused();
    await answerCurrent(page);
    const next = page.getByRole("button", { name: "继续", exact: true }); await expect(next).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await next.press("Enter");
  }
  await expect(page.getByRole("heading", { name: "这一轮完成了", exact: true })).toBeFocused();
  expect((await passageSnapshot(page)).attempts).toHaveLength(run.baseCount);
  await page.screenshot({ path: "issues/assets/passage-review-20261024/round-summary-320.png", fullPage: true });
});

test("a child can stop course audio without losing the current round or reporting cancellation as a failure", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.evaluate(() => { (window as any).__coursePlaybackDelay = 1500; });
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice h1")).toBeVisible();
  const before = await passageSnapshot(page);
  await page.getByRole("button", { name: "查看原文", exact: true }).click();
  await page.getByRole("button", { name: "朗读原文 turn-14", exact: true }).click();
  const stop = page.getByRole("button", { name: "停止播放", exact: true }); await expect(stop).toBeEnabled();
  const bounds = (await stop.boundingBox())!; expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "issues/assets/passage-review-20261024/audio-stop-390.png" });
  await stop.click(); await expect(stop).toHaveCount(0);
  await expect(page.getByRole("button", { name: "检查答案", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "看提示", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: "播放已停止" })).toHaveCount(0);
  const after = await passageSnapshot(page);
  expect(after.attempts).toEqual(before.attempts); expect(after.sessions[0]!.index).toBe(before.sessions[0]!.index);
  await page.getByRole("button", { name: "收起原文", exact: true }).click();
  await expect(page.locator(".passage-practice h1")).toBeFocused(); await answerCurrent(page);
  await expect(page.locator(".passage-feedback")).toBeVisible();
});

test("replaying a completed level begins with an independent recall instead of reteaching its answer", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice h1")).toBeVisible();
  const first = (await passageSnapshot(page)).sessions[0]!;
  for (let index = 0; index < first.baseCount; index++) {
    await answerCurrent(page); await page.getByRole("button", { name: "继续", exact: true }).click();
    await expect(page.locator(".passage-feedback")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "返回学习路径", exact: true }).click();
  await page.getByRole("button", { name: "重练", exact: true }).click();
  await expect(page.getByLabel("填写答案", { exact: true })).toBeVisible();
  await expect(page.locator(".passage-practice h1")).toBeFocused();
  await answerCurrent(page); await expect(page.locator(".passage-feedback")).toBeVisible();
  const state = await passageSnapshot(page), run = state.sessions.at(-1)!;
  expect(run.kind).toBe("replay"); expect(run.schedulerVersion).toBe("5");
  expect(state.attempts.at(-1)).toMatchObject({ sessionId: run.id, assisted: false, evidenceEligible: true });
});

test("an edited material invalidates the old passage candidate and can generate a fresh bank without a save deadlock", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", passage: null }); await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("更新后的闯关教材");
  await page.getByLabel("文章或课文原文", { exact: true }).fill(starterRecord.sourceText);
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await manageCourse(page, "更新后的闯关教材", "课文闯关");
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  const old = (await passageSnapshot(page)).candidates![0]!;
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").check();
  await expect(page.getByText(/有未保存的审核修改/)).toBeVisible();
  await page.getByRole("button", { name: "保存审核草稿", exact: true }).click();
  await expect(page.getByText(/有未保存的审核修改/)).toHaveCount(0);
  await navigate(page, "课程"); await page.locator(".frame-course-entry").filter({ hasText: "更新后的闯关教材" }).click();
  await page.getByRole("button", { name: "教材", exact: true }).click();
  await page.getByRole("button", { name: "编辑教材", exact: true }).click();
  await page.getByLabel("文章或课文原文", { exact: true }).fill(starterRecord.sourceText + "\nAlice: Our new material.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await manageCourse(page, "更新后的闯关教材", "课文闯关");
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toHaveCount(0);
  await expect(page.getByText(/教材已更新，旧候选题库不再适用/)).toBeVisible();
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  const candidates = (await passageSnapshot(page)).candidates!;
  expect(candidates).toHaveLength(2); expect(candidates[0]!.package).toEqual(old.package);
  expect(candidates[1]!.package.source.turns.at(-1)!.text).toBe("Our new material.");
  expect(candidates[1]!.sourceConfirmed).toBe(false);
});
