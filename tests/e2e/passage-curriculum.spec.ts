import { expect, test, type Page } from "@playwright/test";
import { adult, manageCourse, navigate, parentSpace, passageSnapshot, seedApplication } from "./fixtures/application";
import { approve, context, finishSession, fixtureCurriculumPackage, started } from "../fixtures/passage-path";
import { questionFor } from "../../packages/learning-modes/passage-path/references";
const pkg = fixtureCurriculumPackage(), ctx = context(undefined, "legacy-a");

function communication(first: "speak" | "listen-choice") {
  let state = approve(undefined, pkg);
  for (const id of ["discover", "transfer"]) state = finishSession(started(state, ctx, id), ctx, id);
  for (let seed = 0; seed < 40; seed++) {
    const next = started(state, ctx, "communicate", seed);
    if (questionFor(next, next.sessions.at(-1)!.queue[0]!).kind === first) return next;
  }
  throw Error("fixture has no matching first question");
}
async function answerOne(page: Page, oralRating: "ready" | "again" = "ready") {
  await expect(page.locator(".passage-practice h1")).toBeVisible();
  const state = await passageSnapshot(page), run = state.sessions.at(-1)!, question = questionFor(state, run.queue[run.index]!);
  if (question.kind === "speak") {
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await page.getByRole("button", { name: "结束录音并保存", exact: true }).click();
    await page.getByRole("button", { name: "回听我的录音", exact: true }).click();
    const rating = page.getByRole("radio", { name: oralRating === "ready" ? "我能说清楚" : "还想再练一练", exact: true });
    await expect(rating).toBeEnabled(); await rating.check();
    await page.getByRole("button", { name: "提交口语练习", exact: true }).click();
  } else {
    if (question.kind === "listen-choice") await page.getByRole("button", { name: "播放题目音频", exact: true }).click();
    if (question.kind === "cloze") await page.getByLabel("填写答案", { exact: true }).fill(question.answers[0]!);
    else if (question.kind === "order") for (const id of question.correctTokenIds) await page.locator(".passage-tokens").getByRole("button", { name: question.tokens.find(token => token.id === id)!.text, exact: true }).click();
    else await page.locator(".passage-choices").getByRole("button", { name: question.options.find(option => option.id === question.correctOptionId)!.text, exact: true }).click();
    await page.getByRole("button", { name: "检查答案", exact: true }).click();
  }
  await expect(page.locator(".passage-feedback")).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.locator(".passage-feedback")).toHaveCount(0);
}
async function finishRound(page: Page) {
  for (let index = 0; index < 8; index++) {
    if ((await passageSnapshot(page)).sessions.at(-1)!.status !== "active") break;
    await answerOne(page);
  }
  await expect(page.getByRole("heading", { name: "这一轮完成了", exact: true })).toBeVisible();
}

test("three real short lessons teach the same goal, transfer it, then record listening and speaking before advancing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await seedApplication(page, { mode: "passage-path", starter: true, passage: approve(undefined, pkg) }); await page.goto("/");
  await expect(page.getByText("0 / 3 小课已完成", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: "issues/assets/passage-curriculum-20261024/path-320.png", fullPage: true });
  await page.getByRole("button", { name: "开始学习", exact: true }).click(); await expect(page.locator(".passage-practice h1")).toBeVisible();
  await finishRound(page); expect((await passageSnapshot(page)).completions).toHaveLength(0);
  await page.reload(); await page.getByRole("button", { name: "继续本关", exact: true }).click();
  await expect(page.locator(".passage-practice aside")).toContainText("换个情境");
  expect((await passageSnapshot(page)).sessions.at(-1)!.lesson).toBe("transfer");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "issues/assets/passage-curriculum-20261024/transfer-320.png", fullPage: true });
  await finishRound(page); expect((await passageSnapshot(page)).completions).toHaveLength(0);
  await page.getByRole("button", { name: "继续下一小课", exact: true }).click(); await expect(page.locator(".passage-practice h1")).toBeVisible();
  expect((await passageSnapshot(page)).sessions.at(-1)!.lesson).toBe("communicate");
  await finishRound(page);
  const state = await passageSnapshot(page); expect(state.completions).toHaveLength(1);
  expect(state.attempts.some(attempt => attempt.correct === null)).toBe(true);
  expect(state.attempts.filter(attempt => attempt.correct === null).every(attempt => !attempt.evidenceEligible)).toBe(true);
  await expect(page.getByText(/完成 \d+ 次录音回听/)).toBeVisible();
  await page.screenshot({ path: "issues/assets/passage-curriculum-20261024/summary-320.png", fullPage: true });
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await parentSpace(page); await navigate(page, "记录"); await page.getByRole("button", { name: "课文闯关报告", exact: true }).click();
  await expect(page.getByRole("heading", { name: "口语练习回听", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "回听这次练习", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "回听这次练习", exact: true }).first()).toBeEnabled();
});

test("stopping a listening clip does not unlock the answer, and its selection restores without a false playback receipt", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true, passage: communication("listen-choice") }); await page.goto("/");
  await page.getByRole("button", { name: "继续学习", exact: true }).click(); await expect(page.locator(".passage-practice h1")).toBeVisible();
  await page.locator(".passage-choices button").first().click();
  await expect(page.getByRole("button", { name: "检查答案", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__coursePlaybackDelay = 600; });
  await page.getByRole("button", { name: "播放题目音频", exact: true }).click(); await page.getByRole("button", { name: "停止播放", exact: true }).click();
  await expect(page.getByRole("button", { name: "播放题目音频", exact: true })).toBeEnabled();
  expect((await passageSnapshot(page)).sessions.at(-1)!.input.audioPlayed).toBeUndefined();
  await page.reload(); await page.getByRole("button", { name: "继续学习", exact: true }).click();
  await expect(page.getByRole("button", { name: "检查答案", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "播放题目音频", exact: true }).click();
  await expect(page.getByRole("button", { name: "检查答案", exact: true })).toBeEnabled();
});

test("oral permission, interrupted replay, reload and a failed self-assessment save preserve the take and recommend consolidation", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true, passage: communication("speak") }); await page.goto("/");
  await page.getByRole("button", { name: "继续学习", exact: true }).click();
  await page.getByRole("button", { name: "听示范表达", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始录音", exact: true })).toBeEnabled();
  expect((await passageSnapshot(page)).sessions.at(-1)!.helpRequests).toEqual([expect.objectContaining({ kind: "sample", afterAnswer: false })]);
  await page.evaluate(() => { (window as any).__microphoneDenied = true; });
  await page.getByRole("button", { name: "开始录音", exact: true }).click(); await expect(page.getByText(/麦克风未获允许/)).toBeVisible();
  await page.getByRole("button", { name: "请家长开启麦克风", exact: true }).click(); await adult(page);
  await expect.poll(() => page.evaluate(() => (window as any).__openedAppSettings)).toBe(true);
  await page.evaluate(() => { (window as any).__microphoneDenied = false; });
  await page.getByRole("button", { name: "开始录音", exact: true }).click(); await page.getByRole("button", { name: "结束录音并保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "回听我的录音", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "issues/assets/passage-curriculum-20261024/oral-390.png", fullPage: true });
  const path = (await passageSnapshot(page)).sessions.at(-1)!.input.oral!.recordingPath;
  await page.evaluate(() => { (window as any).__recordingDelay = 700; });
  await page.getByRole("button", { name: "回听我的录音", exact: true }).click(); await page.getByRole("button", { name: "停止播放", exact: true }).click();
  await expect(page.getByRole("radio", { name: "我能说清楚", exact: true })).toBeDisabled();
  await page.reload(); await page.getByRole("button", { name: "继续学习", exact: true }).click();
  expect((await passageSnapshot(page)).sessions.at(-1)!.input.oral).toEqual({ recordingPath: path });
  await page.getByRole("button", { name: "回听我的录音", exact: true }).click();
  await expect(page.getByRole("radio", { name: "还想再练一练", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  await page.getByRole("radio", { name: "还想再练一练", exact: true }).check(); await expect(page.getByRole("alert")).toContainText("保存失败");
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("radio", { name: "我能说清楚", exact: true }).check();
  await expect.poll(async () => (await passageSnapshot(page)).sessions.at(-1)!.input.oral?.selfRating).toBe("ready");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("radio", { name: "还想再练一练", exact: true }).check();
  await page.getByRole("button", { name: "提交口语练习", exact: true }).click(); await expect(page.locator(".passage-feedback")).toContainText("口语练习已记录");
  await page.getByRole("button", { name: "继续", exact: true }).click(); await expect(page.locator(".passage-feedback")).toHaveCount(0);
  await finishRound(page); await expect(page.getByRole("button", { name: "巩固这一小课", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "巩固这一小课", exact: true }).click(); await expect(page.locator(".passage-practice h1")).toBeVisible();
  expect((await passageSnapshot(page)).sessions.at(-1)).toMatchObject({ kind: "replay", lesson: "communicate" });
});

test("parents audit transfer situations and oral criteria by short lesson, and edits create a new candidate without changing child progress", async ({ page }) => {
  const passage = approve(undefined, pkg);
  await seedApplication(page, { mode: "passage-path", starter: true, passage }); await page.goto("/");
  await parentSpace(page); await manageCourse(page, pkg.source.title, "课文闯关");
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  await page.getByLabel("审核短课").selectOption("transfer");
  await expect(page.locator(".passage-review-question")).toContainText("换个情境");
  await page.getByRole("button", { name: "修改本题", exact: true }).click();
  await page.getByLabel("新情境说明", { exact: true }).fill("放学后的运动交流，沿用本课已经学过的表达。");
  await page.getByRole("button", { name: "保存本题修改", exact: true }).click();
  await expect(page.locator(".passage-review-question")).toContainText("放学后的运动交流");
  await page.getByLabel("审核短课").selectOption("communicate");
  const candidate = (await passageSnapshot(page)).candidates!.at(-1)!;
  const oralIndex = candidate.package.questions.findIndex(question => question.kind === "speak");
  await page.getByLabel("查看候选题").selectOption(String(oralIndex));
  await expect(page.locator(".passage-review-question")).toContainText("回听要点");
  await page.getByRole("button", { name: "以孩子视角试答", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("录音、完整回听和自评");
  await expect(page.getByRole("button", { name: "开始录音", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "返回审核", exact: true }).click();
  await page.getByRole("button", { name: "修改本题", exact: true }).click();
  await page.getByLabel("示范表达", { exact: true }).fill("I like playing basketball.");
  await page.getByLabel("回听要点（每行一项）", { exact: true }).fill("能让朋友听清喜欢的运动\n说完一句完整表达");
  await page.getByRole("button", { name: "保存本题修改", exact: true }).click();
  await expect(page.locator(".passage-review-question")).toContainText("能让朋友听清喜欢的运动");
  const state = await passageSnapshot(page), revised = state.candidates!.at(-1)!;
  expect(revised.package.revision).not.toBe(pkg.revision);
  expect(revised.reviewedQuestionIds).not.toContain(revised.package.questions[oralIndex]!.id);
  expect(state.packages).toEqual(passage.packages); expect(state.publications).toEqual(passage.publications);
  expect(state.sessions).toEqual(passage.sessions); expect(state.attempts).toEqual(passage.attempts);
});

test("an actual next-day review is offered for the current child and disappears after the review lesson", async ({ page }) => {
  let passage = approve(undefined, pkg);
  for (const id of ["discover", "transfer", "communicate"]) passage = finishSession(started(passage, ctx, id), ctx, id);
  await page.clock.setFixedTime(new Date("2026-10-17T11:00:00.000Z"));
  await seedApplication(page, { mode: "passage-path", starter: true, passage }); await page.goto("/");
  await expect(page.getByRole("heading", { name: "隔天回访", exact: true })).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-10-19T11:00:00.000Z")); await page.reload();
  await expect(page.getByRole("heading", { name: "隔天回访", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始回访短课", exact: true }).click(); await expect(page.locator(".passage-practice h1")).toBeVisible();
  expect((await passageSnapshot(page)).sessions.at(-1)).toMatchObject({ kind: "replay", lesson: "transfer" });
  await finishRound(page); await page.getByRole("button", { name: "返回学习路径", exact: true }).click();
  await expect(page.getByRole("heading", { name: "隔天回访", exact: true })).toHaveCount(0);
  expect((await passageSnapshot(page)).completions).toHaveLength(1);
});
