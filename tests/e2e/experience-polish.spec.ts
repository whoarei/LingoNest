import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { adult, manageCourse, parentSpace, passageSnapshot, seedApplication, snapshot } from "./fixtures/application";
import { gradeExercise } from "../../packages/learning-modes/seven-step/engine";
import { makeCourseAudioSpec } from "../../packages/learning-modes/seven-step/audio";
const legacy = JSON.parse(readFileSync(new URL("../fixtures/seven-step-legacy.json", import.meta.url), "utf8"));

test("grouped authoring and child-view previews use real answer controls without recording learning or approval", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true, passage: null }); await page.goto("/");
  await parentSpace(page); await manageCourse(page, "一起加入运动队", "课文闯关");
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库" })).toBeVisible();
  await page.getByLabel("审核关卡").selectOption("level-like");
  await expect(page.getByLabel("查看候选题").locator("option")).toHaveCount(12);
  const before = await passageSnapshot(page), question = before.candidates![0]!.package.questions[2]!;
  if (question.kind !== "order") throw Error("Fixture must contain an ordering task.");
  await page.getByLabel("查看候选题").selectOption("2"); await page.getByRole("button", { name: "以孩子视角试答" }).click();
  const preview = page.getByRole("dialog", { name: "孩子视角预览" });
  await expect(preview.locator(".passage-question-input")).toBeVisible();
  for (const id of question.correctTokenIds) await preview.locator(".passage-tokens").getByRole("button", { name: question.tokens.find(token => token.id === id)!.text, exact: true }).click();
  await preview.getByRole("button", { name: "检查预览答案" }).click(); await expect(preview).toContainText("答对了");
  await page.keyboard.press("Escape"); await expect(preview).toHaveCount(0);
  await expect(page.getByRole("button", { name: "以孩子视角试答" })).toBeFocused();
  await page.getByLabel("查看候选题").selectOption("1"); await page.getByRole("button", { name: "以孩子视角试答" }).click();
  const cloze = before.candidates![0]!.package.questions[1]!; if (cloze.kind !== "cloze") throw Error("Expected cloze.");
  await preview.getByLabel("填写答案").fill(cloze.answers[0]!); await preview.getByLabel("填写答案").press("Enter");
  await expect(preview).toContainText("答对了"); await page.evaluate(() => (window as any).__nativeBack()); await expect(preview).toHaveCount(0);
  const after = await passageSnapshot(page);
  expect(after.attempts).toEqual(before.attempts); expect(after.sessions).toEqual(before.sessions);
  expect(after.candidates![0]!.reviewedQuestionIds).toEqual([]);
  await page.getByLabel("审核关卡").selectOption("all"); await page.getByLabel("审核目标").selectOption("goal-invite");
  await expect(page.getByLabel("查看候选题").locator("option")).toHaveCount(12);
  await page.getByRole("button", { name: "审核通过，下一题", exact: true }).click();
  await expect(page.getByLabel("查看候选题")).toHaveValue("13");
  expect((await passageSnapshot(page)).candidates![0]!.reviewedQuestionIds).toEqual(["question-invite-0"]);
  await page.getByLabel("查看候选题").selectOption("23");
  await page.getByRole("button", { name: "审核通过，下一题", exact: true }).click();
  await expect(page.getByLabel("查看候选题")).toHaveValue("13");
  await page.getByLabel("审核关卡").selectOption("level-like"); await expect(page.getByLabel("审核目标")).toHaveValue("all");
  await expect(page.getByLabel("审核目标").locator("option")).toHaveCount(2);
});

test("a guided oral round leads into a fresh independent attempt that resumes without losing the guided recording", async ({ page }) => {
  await seedApplication(page);
  const course = legacy.snapshot.courses[0], at = new Date().toISOString();
  const prep = ["S1", "S2", "S3"].map(stageId => {
    const exercises = course.package.exercises.filter((exercise: any) => exercise.stageId === stageId);
    return { stageId, exercises, attempts: exercises.map((exercise: any, index: number) => {
      const response = { answer: exercise.acceptedAnswers[0] ?? "", selectedIds: exercise.kind === "choice" ? exercise.correctOptionIds : exercise.kind === "order" ? exercise.correctTokenIds : [], recordingPath: null };
      if (["choice", "order"].includes(exercise.kind)) response.answer = "";
      return { id: `ready-${stageId}-${index}`, clientEventId: `client-${stageId}-${index}`, learnerId: "legacy-a", sessionId: `ready-${stageId}`, exerciseId: exercise.id, ...response, hintLevel: 0, submittedAt: at, localDate: at.slice(0,10), timezone: "UTC", clockStatus: "normal", firstTest: true, grade: gradeExercise(exercise, response) };
    }) };
  });
  await page.addInitScript(({ prep, audio }) => {
    if (sessionStorage.getItem("oral-polish-seeded")) return;
    const fixture = JSON.parse(sessionStorage.getItem("speech-native-fixture")!), data = JSON.parse(fixture.payload);
    for (const stage of prep) {
      data.runs.push({ id: `ready-${stage.stageId}`, learnerId: "legacy-a", courseId: audio.courseId, stageId: stage.stageId, exerciseIds: stage.exercises.map((exercise: any) => exercise.id), index: stage.exercises.length, label: stage.stageId, hints: {}, answer: "", selectedIds: [], recordingPath: null });
      for (const attempt of stage.attempts) data.events.push({ id: `event-${attempt.id}`, type: "attempt", learnerId: attempt.learnerId, at: attempt.submittedAt, attempt });
    }
    const variant = JSON.stringify([fixture.cfg.protocol, fixture.cfg.baseUrl, fixture.cfg.model, fixture.cfg.voice, fixture.cfg.instructions]);
    fixture.resources[audio.courseId + ":" + audio.courseVersion] = { total: audio.assets.length, variants: { [variant]: { files: audio.assets.map(asset => asset.id), voice: fixture.cfg.voice, model: fixture.cfg.model } }, active: variant, draft: "" };
    fixture.payload = JSON.stringify(data); sessionStorage.setItem("speech-native-fixture", JSON.stringify(fixture)); sessionStorage.setItem("oral-polish-seeded", "1");
  }, { prep, audio: makeCourseAudioSpec(course.package.course, course.package.exercises) });
  await page.goto("/"); await page.locator(".stage-row").filter({ hasText: "开口朗读" }).click();
  await page.getByRole("button", { name: /听一遍示范/ }).click(); await expect(page.getByRole("button", { name: "已使用提示", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始录音", exact: true }).click(); await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await page.getByRole("button", { name: "提交录音", exact: true }).click(); await page.getByRole("button", { name: "完成这一轮", exact: true }).click();
  await expect(page.locator(".practice-finished")).toContainText("刚才借助示范");
  await expect(page.locator(".practice-finished .button-group button:visible")).toHaveCount(2);
  await expect(page.locator(".round-details")).not.toHaveAttribute("open", "");
  const guided = (await snapshot(page)).events.filter((event: any) => event.type === "attempt").at(-1).attempt;
  await page.getByRole("button", { name: "独立再试一次", exact: true }).click();
  await expect(page.getByText(/独立尝试：看着原文/)).toBeVisible();
  const independent = (await snapshot(page)).runs.at(-1);
  expect(independent).toMatchObject({ purpose: "independent", answer: "", recordingPath: null, hints: {} });
  expect(guided.hintLevel).toBe(3);
  await page.getByRole("button", { name: "保存并退出", exact: true }).click(); await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await expect(page.locator('.stage-list')).toBeVisible();
  const savedIndependent = (await snapshot(page)).runs.at(-1);
  await page.reload(); await page.locator(".stage-row").filter({ hasText: "开口朗读" }).click();
  await expect(page.getByText(/独立尝试：看着原文/)).toBeVisible();
  const restored = await snapshot(page);
  expect(restored.runs.at(-1)).toEqual(savedIndependent);
  expect(restored.events.find((event: any) => event.type === "attempt" && event.attempt.id === guided.id).attempt).toEqual(guided);
  await page.getByRole("button", { name: "开始录音", exact: true }).click(); await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await page.getByRole("button", { name: "提交录音", exact: true }).click(); await page.getByRole("button", { name: "完成这一轮", exact: true }).click();
  await page.getByRole("button", { name: "回到学习路线", exact: true }).click();
  await page.locator(".stage-row").filter({ hasText: "开口朗读" }).click();
  await page.getByRole("button", { name: /听一遍示范/ }).click(); await expect(page.getByRole("button", { name: "已使用提示", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始录音", exact: true }).click(); await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await page.getByRole("button", { name: "提交录音", exact: true }).click(); await page.getByRole("button", { name: "完成这一轮", exact: true }).click();
  await page.locator(".round-details summary").click(); await page.getByRole("button", { name: "请家长回听示范练习", exact: true }).click();
  await adult(page);
  await expect(page.locator(".parent-review-card").first()).toContainText("独立尝试");
  await expect(page.locator(".parent-review-card")).toHaveCount(3);
});

test("short rounds finish clearly and Enter drains pending input saves without duplicate answers", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const initial = await passageSnapshot(page), run = initial.sessions.at(-1)!;
  expect(run.baseCount).toBe(4);
  let usedEnter = false;
  for (let position = 0; position < run.baseCount; position++) {
    const data = await passageSnapshot(page), session = data.sessions.at(-1)!, item = session.queue[session.index]!;
    const question = data.packages.find(pkg => pkg.revision === item.revision)!.questions.find(question => question.id === item.questionId)!;
    await expect(page.locator(".passage-practice h1")).toHaveText(question.prompt);
    if (question.kind === "cloze") {
      await page.evaluate(() => { (window as any).__documentSaveDelay = 80; });
      const input = page.getByLabel("填写答案", { exact: true });
      await input.fill("unfinished"); await input.fill(question.answers[0]!); await input.press("Enter");
      await expect(page.locator(".passage-feedback")).toContainText("答对了");
      // Android IME can deliver another Enter after the answer is shown.
      await input.dispatchEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true });
      await page.evaluate(() => { (window as any).__documentSaveDelay = 0; }); usedEnter = true;
    } else {
      if (question.kind === "order") for (const id of question.correctTokenIds) await page.locator(".passage-tokens").getByRole("button", { name: question.tokens.find(token => token.id === id)!.text, exact: true }).click();
      else await page.locator(".passage-choices").getByRole("button", { name: question.options.find(option => option.id === question.correctOptionId)!.text, exact: true }).click();
      await page.getByRole("button", { name: "检查答案", exact: true }).click();
    }
    await expect(page.locator(".passage-feedback")).toContainText("答对了");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.locator(".passage-feedback").getByRole("button", { name: "继续", exact: true }).click();
    await expect(page.locator(".passage-feedback")).toHaveCount(0);
  }
  expect(usedEnter).toBe(true);
  expect((await passageSnapshot(page)).attempts).toHaveLength(4);
  await expect(page.locator(".passage-round-summary")).toContainText("这轮练过：表达爱好");
  await expect(page.locator(".passage-round-summary details")).not.toHaveAttribute("open", "");
  const bounds = await page.getByRole("button", { name: "进入下一关", exact: true }).boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(844);
});
