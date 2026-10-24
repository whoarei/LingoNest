import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { adult, manageCourse, navigate, parentSpace } from "./fixtures/application";
import { approve, context, finishSession, fixturePackage, started } from "../fixtures/passage-path";
import { makePassageAudioManifest } from "../../packages/learning-modes/passage-path/authoring";
import type { PassageState } from "../../packages/learning-modes/passage-path/model";
import { newCourse, starterRecord, type CourseRecord } from "../../packages/learning-modes/seven-step/authoring";
const legacy = JSON.parse(readFileSync(new URL("../fixtures/seven-step-legacy.json", import.meta.url), "utf8"));
const stateKey = "native-document:lingonest.passage-path.v1";
const settingsKey = "native-document:lingonest.mode-settings.v1";
async function seed(page: Page, options: { mode?: string; published?: boolean; passage?: PassageState; extraCourses?: CourseRecord[]; legacyApis?: boolean } = {}) {
  if (options.legacyApis) await page.addInitScript(() => {
    Object.defineProperty(Array.prototype, "at", { value: undefined, writable: true, configurable: true });
    Object.defineProperty(Promise, "allSettled", { value: undefined, writable: true, configurable: true });
  });
  await page.route("**/src/native.ts", route => route.fulfill({ contentType: "application/javascript", body: readFileSync(new URL("./fixtures/speech-native.js", import.meta.url), "utf8") }));
  await page.route("**/src/platform/content.ts", route => route.fulfill({ contentType: "application/javascript", body: readFileSync(new URL("./fixtures/course-content.js", import.meta.url), "utf8") }));
  const passage = options.passage ?? (options.published ? approve() : null);
  const manifests = passage?.publications.map(publication => makePassageAudioManifest(passage.packages.find(pkg => pkg.courseId === publication.courseId && pkg.revision === publication.revision)!)) ?? [];
  await page.addInitScript(({ snapshot, mode, passage, manifests, settingsKey, stateKey, starter }) => {
    if (!sessionStorage.getItem("speech-native-fixture")) {
      const cfg = { mode: "ai", protocol: "openai-speech", baseUrl: "https://speech.example.com/v1", model: "test-tts", voice: "alloy", speed: .9, instructions: "", hasKey: true };
      const variant = JSON.stringify([cfg.protocol, cfg.baseUrl, cfg.model, cfg.voice, cfg.instructions]);
      sessionStorage.setItem("speech-native-fixture", JSON.stringify({ revision: 7, payload: JSON.stringify({ ...snapshot, learningCourseIds: { ...snapshot.learningCourseIds, "legacy-a": starter } }), cfg, cache: [], variants: {}, active: "", draft: "", requests: 0, plays: 0,
        resources: Object.fromEntries(manifests.map(manifest => [manifest.courseId + ":" + manifest.courseVersion, { total: manifest.assets.length, variants: { [variant]: { files: manifest.assets.map(item => item.id), voice: cfg.voice, model: cfg.model } }, active: variant, draft: "" }])) }));
      sessionStorage.setItem(settingsKey, JSON.stringify({ revision: 1, payload: JSON.stringify({ formatVersion: 1, activeModeId: mode }) }));
      if (passage) sessionStorage.setItem(stateKey, JSON.stringify({ revision: 1, payload: JSON.stringify(passage) }));
    }
  }, { snapshot: { ...legacy.snapshot, courses: [...legacy.snapshot.courses, ...(options.extraCourses ?? [])] }, mode: options.mode ?? "passage-path", passage, manifests, settingsKey, stateKey, starter: starterRecord.id });
}
async function confirm(page: Page) { await adult(page); }
async function state(page: Page): Promise<PassageState> { return page.evaluate(key => JSON.parse(JSON.parse(sessionStorage.getItem(key)!).payload), stateKey); }
async function oldState(page: Page) { return page.evaluate(() => JSON.parse(JSON.parse(sessionStorage.getItem("speech-native-fixture")!).payload)); }
async function parent(page: Page) { await expect(page.locator(".application-navigation")).toBeVisible(); if (await page.getByRole("navigation", { name: "主导航" }).isVisible()) await parentSpace(page); await manageCourse(page, starterRecord.title, "课文闯关"); }
async function generate(page: Page) { await parent(page); await page.getByRole("button", { name: "生成闯关题库", exact: true }).click(); await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible(); }
async function audit(page: Page) {
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").check();
  const selector = page.getByLabel("查看候选题");
  const count = await selector.locator("option").count();
  for (let index = 0; index < count; index++) { await selector.selectOption(String(index)); await page.getByLabel("本题语境、答案和说明已审核").check(); }
}

async function exit(page: Page) {
  await page.locator(".application-focusbar").getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
}
async function child(page: Page, nickname: string) {
  await parentSpace(page); await page.getByRole("button", { name: "管理孩子档案", exact: true }).click();
  await page.locator(".frame-list-row").filter({ hasText: nickname }).getByRole("button", { name: "切换档案" }).click();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
}

test("single-question correction, returned audit and failed-save recovery preserve the publication and other decisions", async ({ page }) => {
  await seed(page); await page.goto("/"); await generate(page);
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").check();
  await page.getByRole("button", { name: "审核通过，下一题", exact: true }).click();
  const approved = (await state(page)).candidates![0]!;
  await expect(page.getByLabel("查看候选题")).toHaveValue("1");
  await page.getByRole("button", { name: "退回修改", exact: true }).click();
  await expect.poll(async () => (await state(page)).candidates![0]!.returnedQuestionIds?.length).toBe(1);
  await page.getByRole("button", { name: "修改本题", exact: true }).click();
  await page.getByLabel("答案说明", { exact: true }).fill("修订后的说明：请联系完整语境理解。");
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  await page.getByRole("button", { name: "保存本题修改", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("答案说明", { exact: true })).toHaveValue("修订后的说明：请联系完整语境理解。");
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("button", { name: "保存本题修改", exact: true }).click();
  await expect(page.getByRole("form", { name: "修改候选题" })).toHaveCount(0);
  const corrected = (await state(page)).candidates!.at(-1)!;
  expect(corrected.package.revision).not.toBe(approved.package.revision);
  expect(corrected.reviewedQuestionIds).toEqual(approved.reviewedQuestionIds);
  expect(corrected.returnedQuestionIds).toEqual([]);
  await page.reload(); await parent(page);
  await expect(page.getByLabel("查看候选题")).toHaveValue("1");
  await expect(page.locator(".passage-review-question")).toContainText("修订后的说明");
  await page.getByRole("button", { name: "待审核", exact: true }).click();
  await expect(page.getByLabel("查看候选题").locator("option")).toHaveCount(23);
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await expect(page.getByLabel("查看候选题")).toHaveValue("2");
  await page.getByRole("button", { name: "全部题目", exact: true }).click();
  await audit(page); await page.getByRole("button", { name: "生成 / 继续整课音频", exact: true }).click();
  await confirm(page); await expect(page.getByRole("button", { name: "审核并启用本版本", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "审核并启用本版本", exact: true }).click(); await confirm(page);
  await expect(page.getByRole("button", { name: "本修订已发布", exact: true })).toBeDisabled();
  const published = await state(page);
  await page.getByLabel("查看候选题").selectOption("1");
  await page.getByRole("button", { name: "修改本题", exact: true }).click();
  await page.getByLabel("答案说明", { exact: true }).fill("已发布之后的新候选说明。");
  await navigate(page, "设置");
  const revised = await state(page);
  expect(revised.packages).toEqual(published.packages); expect(revised.publications).toEqual(published.publications);
  expect(revised.candidates!.at(-1)!.package.questions[1]!.explanation).toBe("已发布之后的新候选说明。");
});

test("one exit dialog preserves wrong-answer detail and separates explicit help from consolidation", async ({ page }) => {
  await seed(page, { published: true }); await page.goto("/"); await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存并退出", exact: true })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "闯关导航" })).toHaveCount(0);
  await page.getByRole("button", { name: "查看原文", exact: true }).click();
  await page.getByRole("button", { name: "收起原文", exact: true }).click();
  const before = await state(page), session = before.sessions[0]!, item = session.queue[0]!;
  const question = before.packages.find(pkg => pkg.courseId === item.courseId && pkg.revision === item.revision)!.questions.find(question => question.id === item.questionId)!;
  if (!("options" in question)) throw Error("Fixture must begin with a recognition question.");
  const wrong = question.options.find(option => option.id !== question.correctOptionId)!;
  await page.locator(".passage-choices").getByRole("button", { name: wrong.text, exact: true }).click();
  await page.getByRole("button", { name: "检查答案", exact: true }).click();
  await expect(page.locator(".passage-feedback")).toContainText("补练");
  await page.evaluate(() => { (window as any).__nativeBack(); });
  await expect(page.locator(".frame-modal")).toContainText("保存进度");
  await page.getByRole("button", { name: "继续练习", exact: true }).click();
  await expect(page.locator(".passage-feedback")).toBeVisible();
  await exit(page); await navigate(page, "记录");
  await page.locator(".frame-list-row").filter({ hasText: question.prompt }).getByRole("button", { name: "查看作答", exact: true }).click();
  await expect(page.locator(".frame-record-detail")).toContainText(wrong.text);
  await expect(page.locator(".frame-record-detail")).toContainText("需要再练");
  await expect(page.locator(".frame-record-detail")).toContainText("主动查看原文");
  await page.getByRole("button", { name: "查看模式报告", exact: true }).click();
  await expect(page.getByText(/主动查看提示或原文 1 项/)).toBeVisible();
  await page.getByRole("button", { name: "返回作答详情", exact: true }).click();
  await expect(page.locator(".frame-record-detail")).toContainText(question.prompt);
});
test("real mode switching retains the current material and all old teaching facts", async ({ page }) => {
  await seed(page, { mode: "seven-step" }); await page.goto("/"); const original = await oldState(page);
  await parentSpace(page); await navigate(page, "设置");
  await page.getByRole("radio", { name: /课文闯关/ }).click(); await confirm(page);
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".course-mode-notice")).toContainText("本课尚未生成");
  await navigate(page, "课程"); await page.locator(".frame-course-entry").filter({ hasText: legacy.snapshot.courses[0]!.title }).click();
  await expect(page.locator(".course-mode-notice")).toContainText(legacy.snapshot.courses[0]!.title);
  await parentSpace(page); await navigate(page, "设置");
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await expect(page.locator(".stage-list")).toBeVisible();
  const after = await oldState(page); expect(after.courses).toEqual(original.courses); expect(after.events).toEqual(original.events); expect(after.runs).toEqual(original.runs);
});

test("generation requires the complete bank audit and actual audio before publication, then learns offline", async ({ page }) => {
  await seed(page); await page.goto("/"); const original = await oldState(page);
  await generate(page);
  await expect(page.getByRole("button", { name: "审核并启用本版本", exact: true })).toBeDisabled();
  await audit(page);
  await expect(page.getByRole("button", { name: "审核并启用本版本", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__speechDelay = 50; });
  await page.getByRole("button", { name: "生成 / 继续整课音频", exact: true }).click(); await confirm(page);
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "审核并启用本版本", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "审核并启用本版本", exact: true }).click();
  await confirm(page);
  await expect.poll(async () => (await state(page)).publications.length).toBe(1);
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await page.evaluate(() => { (window as any).__speechOffline = true; (window as any).__contentFailure = true; });
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice")).toBeVisible();
  await page.getByRole("button", { name: "查看原文", exact: true }).click();
  await page.getByRole("button", { name: "朗读原文 turn-1", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__coursePlays)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "收起原文", exact: true }).click();
  for (let index = 0; index < 10; index++) {
    const before = await state(page), session = before.sessions.find(item => item.status === "active"); if (!session) break;
    const item = session.queue[session.index]!, pkg = before.packages.find(pkg => pkg.courseId === item.courseId && pkg.revision === item.revision)!;
    const question = pkg.questions.find(question => question.id === item.questionId)!;
    if (question.kind === "cloze") await page.getByLabel("填写答案", { exact: true }).fill(question.answers[0]!);
    else if (question.kind === "order") for (const id of question.correctTokenIds) await page.locator(".passage-tokens").getByRole("button", { name: question.tokens.find(token => token.id === id)!.text, exact: true }).click();
    else await page.locator(".passage-choices").getByRole("button", { name: question.options.find(option => option.id === question.correctOptionId)!.text, exact: true }).click();
    await page.getByRole("button", { name: "检查答案", exact: true }).click();
    await expect(page.locator(".passage-feedback")).toContainText("答对了");
    await page.locator(".passage-feedback").getByRole("button", { name: "继续", exact: true }).click();
    await expect(page.locator(".passage-feedback")).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "这一轮完成了", exact: true })).toBeVisible();
  expect((await state(page)).completions).toHaveLength(1);
  const after = await oldState(page); expect(after).toEqual(original);
  await page.getByRole("button", { name: "返回学习路径", exact: true }).click();
  await page.screenshot({ path: "artifacts/passage-path-home-390.png", fullPage: true });
});

test("queued input and feedback survive reload, shared profile changes and a mode round trip", async ({ page }) => {
  await seed(page, { published: true }); await page.goto("/"); await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const choice = page.locator(".passage-choices button").first();
  if (await choice.count()) await choice.click();
  else if (await page.getByLabel("填写答案", { exact: true }).count()) await page.getByLabel("填写答案", { exact: true }).fill("unfinished");
  else await page.locator(".passage-tokens button").first().click();
  await expect.poll(async () => (await state(page)).sessions[0]!.input).not.toEqual({ text: "", selectedIds: [] });
  const saved = (await state(page)).sessions[0]!;
  await page.reload(); await page.getByRole("button", { name: "继续学习", exact: true }).click();
  expect((await state(page)).sessions[0]).toEqual(saved);
  await page.getByRole("button", { name: "检查答案", exact: true }).click();
  await expect(page.locator(".passage-feedback")).toBeVisible();
  const feedback = (await state(page)).sessions[0]!; await exit(page);
  await child(page, "旧档案乙"); await child(page, "旧档案甲");
  await parentSpace(page); await navigate(page, "设置");
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await page.getByRole("radio", { name: /课文闯关/ }).click(); await confirm(page);
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await page.getByRole("button", { name: "继续学习", exact: true }).click();
  expect((await state(page)).sessions[0]).toEqual(feedback);
  await expect(page.locator(".passage-feedback")).toBeVisible();
});

test("failed draft saves keep the editor and mode; settings and native back preserve their origin", async ({ page }) => {
  await seed(page); await page.goto("/"); await generate(page);
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").check();
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  await expect(page.getByLabel("我已核对全部原文、知识块与关卡安排")).toBeChecked();
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__nativeBack(); });
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.evaluate(() => { (window as any).__modeSaveFailure = true; });
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".mode-workspace")).toHaveAttribute("data-mode-id", "passage-path");
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".mode-workspace")).toHaveAttribute("data-mode-id", "seven-step");
  await expect(page.getByRole("button", { name: "返回学习报告", exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__nativeBack(); });
  await expect(page.locator(".stage-list")).toBeVisible();
});

test("the shared frame, path and authoring views fit narrow screens", async ({ page }) => {
  await seed(page, { published: true }); await page.goto("/");
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await generate(page);
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
});

test("lost audio blocks submission and resume while the original remains available", async ({ page }) => {
  await seed(page, { published: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  const choice = page.locator(".passage-choices button").first();
  await choice.click();
  await page.evaluate(async () => {
    // @ts-expect-error browser-only module path
    const { native } = await import('/src/native.ts');
    // @ts-expect-error browser-only module path
    const { makePassageAudioManifest } = await import('/packages/learning-modes/passage-path/authoring.ts');
    const state = JSON.parse(JSON.parse(sessionStorage.getItem('native-document:lingonest.passage-path.v1')!).payload);
    await native.clearCourseAudio({ course: makePassageAudioManifest(state.packages[0]) });
  });
  await page.getByRole("button", { name: "检查答案", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("音频");
  expect((await state(page)).attempts).toHaveLength(0);
  await page.getByRole("button", { name: "查看原文", exact: true }).click();
  await expect(page.locator(".passage-original")).toBeVisible();
  await exit(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "继续学习", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "课文原文", exact: true }).click();
  await expect(page.locator(".passage-original")).toBeVisible();
});

test("new shared material must save before leaving and never publishes seven-step content implicitly", async ({ page }) => {
  await seed(page); await page.goto("/"); await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("闯关新增教材草稿");
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.evaluate(() => { (window as any).__saveFailure = true; }); await navigate(page, "设置");
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("闯关新增教材草稿");
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__saveFailure = false; }); await navigate(page, "设置");
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  const saved = await oldState(page), draft = saved.courses.find((course: { title: string }) => course.title === "闯关新增教材草稿");
  expect(draft.status).toBe("source"); expect(draft.package).toBeNull();
  expect(saved.events).toEqual(legacy.snapshot.events); expect(saved.runs).toEqual(legacy.snapshot.runs);
});

test("unloading a pending generation ignores its result and cannot cancel the replacement experience", async ({ page }) => {
  await page.route("**/src/main.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `\nwindow.__remount = () => {
      document.getElementById('app').__vue_app__.unmount();
      const replacement = createApp(App); createApplicationServices().install(replacement); replacement.mount('#app');
    };` });
  });
  await seed(page); await page.goto("/"); await parent(page);
  await page.evaluate(() => { (window as any).__contentDelay = 600; });
  await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__contentRequests)).toBe(1);
  await page.evaluate(() => {
    (window as any).__remount();
    (window as any).__contentDelay = 800;
  });
  await parent(page); await page.getByRole("button", { name: "生成闯关题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  expect((await state(page)).candidates).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__contentRequests)).toBe(2);
  expect((await state(page)).publications).toHaveLength(0);
});

test("real cross-course review shows its own original and audio and excludes another child's unseen history", async ({ page }) => {
  const record = newCourse(); record.title = "穿插复习的来源课程"; record.sourceText = starterRecord.sourceText;
  const previous = fixturePackage(record.id); previous.source.title = record.title;
  const ctx = context(record.id, "legacy-a", "2026-10-14T10:00:00.000Z");
  const passage = finishSession(started(approve(approve(), previous), ctx, "previous"), ctx, "previous", false);
  await seed(page, { passage, extraCourses: [record] }); await page.goto("/"); const old = await oldState(page);
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice")).toBeVisible();
  const run = (await state(page)).sessions.find(session => session.status === "active")!;
  expect(run.queue.filter(item => item.courseId === record.id).length).toBeGreaterThan(0);
  expect(run.queue.filter(item => item.courseId === record.id).length).toBeLessThanOrEqual(2);
  const crossIndex = run.queue.findIndex(item => item.courseId === record.id);
  for (let index = 0; index <= crossIndex; index++) {
    const current = await state(page), active = current.sessions.find(session => session.id === run.id)!, item = active.queue[active.index]!;
    const question = current.packages.find(pkg => pkg.courseId === item.courseId && pkg.revision === item.revision)!.questions.find(question => question.id === item.questionId)!;
    if (index === crossIndex) {
      await expect(page.locator(".passage-practice .eyebrow").filter({ hasText: "穿插复习" })).toContainText(record.title);
      await page.getByRole("button", { name: "查看原文", exact: true }).click();
      await expect(page.locator(".passage-original h2")).toContainText(record.title);
      await page.getByRole("button", { name: "朗读原文 turn-1", exact: true }).click();
      await page.getByRole("button", { name: "收起原文", exact: true }).click();
    }
    if (question.kind === "cloze") await page.getByLabel("填写答案", { exact: true }).fill(question.answers[0]!);
    else if (question.kind === "order") for (const id of question.correctTokenIds) await page.locator(".passage-tokens").getByRole("button", { name: question.tokens.find(token => token.id === id)!.text, exact: true }).click();
    else await page.locator(".passage-choices").getByRole("button", { name: question.options.find(option => option.id === question.correctOptionId)!.text, exact: true }).click();
    await page.getByRole("button", { name: "检查答案", exact: true }).click();
    await expect(page.locator(".passage-feedback")).toContainText("答对了");
    if (index < crossIndex) {
      await page.locator(".passage-feedback").getByRole("button", { name: "继续", exact: true }).click();
      await expect(page.locator(".passage-feedback")).toHaveCount(0);
    }
  }
  expect((await state(page)).attempts.at(-1)!.item.courseId).toBe(record.id);
  await exit(page);
  await child(page, "旧档案乙");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice")).toBeVisible();
  const other = (await state(page)).sessions.find(session => session.learnerId === "legacy-b")!;
  expect(other.queue.every(item => item.courseId === starterRecord.id)).toBe(true);
  const after = await oldState(page); expect(after.events).toEqual(old.events); expect(after.runs).toEqual(old.runs); expect(after.courses).toEqual(old.courses);
});

test("navigation waits for the latest review edit received while its previous snapshot is saving", async ({ page }) => {
  await seed(page);
  await page.route("**/src/native.ts", route => route.fulfill({ contentType: "application/javascript", body:
    readFileSync(new URL("./fixtures/speech-native.js", import.meta.url), "utf8").replace(
      'saveDocument: async ({ key, expectedRevision, payload }) => {',
      `saveDocument: async ({ key, expectedRevision, payload }) => {
        if (key === 'lingonest.passage-path.v1' && window.__holdPassageSave) {
          window.__holdPassageSave = false; window.__savingPassage = true;
          await new Promise(resolve => { window.__releasePassageSave = resolve; });
        }`,
    ) }));
  await page.goto("/"); await generate(page);
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").check();
  await page.evaluate(() => { (window as any).__holdPassageSave = true; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__savingPassage)).toBe(true);
  // Model a final input/composition event delivered after navigation locked the controls.
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").evaluate(element => {
    (element as HTMLInputElement).checked = false; element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate(() => { (window as any).__releasePassageSave(); });
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  expect((await state(page)).candidates![0]!.sourceConfirmed).toBe(false);
  await page.getByRole("button", { name: "返回内容准备", exact: true }).click();
  await expect(page.getByLabel("我已核对全部原文、知识块与关卡安排")).not.toBeChecked();
});

test("old WebViews can enter the mode, restore a saved candidate and start a scheduled session without modern builtins", async ({ page }) => {
  await seed(page, { published: true, legacyApis: true }); await page.goto("/");
  await expect(page.locator(".passage-path-mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
  await generate(page);
  const candidates = (await state(page)).candidates;
  await page.reload(); await parent(page);
  await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible();
  expect((await state(page)).candidates).toEqual(candidates);
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice")).toBeVisible();
  expect((await state(page)).sessions[0]!.queue).toHaveLength(4);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
