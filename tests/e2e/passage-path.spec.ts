import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
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
async function confirm(page: Page) { await page.getByLabel("7加5的答案").fill("12"); await page.getByRole("button", { name: "确认并继续", exact: true }).click(); }
async function state(page: Page): Promise<PassageState> { return page.evaluate(key => JSON.parse(JSON.parse(sessionStorage.getItem(key)!).payload), stateKey); }
async function oldState(page: Page) { return page.evaluate(() => JSON.parse(JSON.parse(sessionStorage.getItem("speech-native-fixture")!).payload)); }
async function parent(page: Page) { await page.getByRole("button", { name: "家长空间", exact: true }).click(); await confirm(page); }
async function generate(page: Page) { await parent(page); await page.getByRole("button", { name: "生成闯关题库", exact: true }).click(); await expect(page.getByRole("heading", { name: "审核整个候选题库", exact: true })).toBeVisible(); }
async function audit(page: Page) {
  await page.getByLabel("我已核对全部原文、知识块与关卡安排").check();
  const selector = page.getByLabel("查看候选题");
  const count = await selector.locator("option").count();
  for (let index = 0; index < count; index++) { await selector.selectOption(String(index)); await page.getByLabel("本题语境、答案和说明已审核").check(); }
}

test("real mode switching blocks unprepared courses and restores all legacy teaching facts", async ({ page }) => {
  await seed(page, { mode: "seven-step" }); await page.goto("/");
  const original = await oldState(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("radio", { name: /课文闯关/ }).click(); await confirm(page);
  await expect(page.locator(".passage-path-mode")).toBeVisible();
  await expect(page.locator(".seven-step-mode")).toHaveCount(0);
  await expect(page.locator(".course-mode-notice")).toContainText("本课尚未生成");
  await expect(page.getByRole("button", { name: "开始学习", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "学习课程", exact: true }).selectOption(legacy.snapshot.courses[0]!.id);
  await expect(page.locator(".course-mode-notice")).toContainText(legacy.snapshot.courses[0]!.title);
  await parent(page);
  await expect(page.getByLabel("课程标题", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("已确认课文", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  const after = await oldState(page);
  expect(after.courses).toEqual(original.courses); expect(after.events).toEqual(original.events); expect(after.runs).toEqual(original.runs);
  await page.reload(); await expect(page.locator(".seven-step-mode")).toBeVisible();
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
  await expect(page.getByRole("combobox", { name: "管理课程", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeDisabled();
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

test("restores exact queued input and feedback through reload, profile changes and a mode round trip", async ({ page }) => {
  await seed(page, { published: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.locator(".passage-practice")).toBeVisible();
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
  const feedback = (await state(page)).sessions[0]!;
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByLabel("当前孩子").selectOption("legacy-b");
  await page.getByLabel("当前孩子").selectOption("legacy-a");
  await page.getByRole("combobox", { name: "学习课程", exact: true }).selectOption(legacy.snapshot.courses[0]!.id);
  await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("radio", { name: /课文闯关/ }).click(); await confirm(page);
  await expect(page.locator(".course-mode-notice")).toBeVisible();
  await page.getByRole("combobox", { name: "学习课程", exact: true }).selectOption(starterRecord.id);
  await page.getByRole("button", { name: "继续学习", exact: true }).click();
  expect((await state(page)).sessions[0]).toEqual(feedback);
  await expect(page.locator(".passage-feedback")).toBeVisible();
  await expect(page.getByRole("button", { name: "检查答案", exact: true })).toHaveCount(0);
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
  await expect(page.locator(".passage-path-mode")).toBeVisible();
  await expect(page.getByRole("radio", { name: /课文闯关/ })).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => { (window as any).__modeSaveFailure = false; });
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
});

test("narrow screens and old-WebView spacing survive switching back to seven-step", async ({ page }) => {
  await seed(page, { published: true }); await page.goto("/");
  await page.locator(".passage-path-mode").evaluate(element => element.classList.add("no-flex-gap"));
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const buttons = page.locator(".passage-header .passage-actions button");
    const first = (await buttons.nth(0).boundingBox())!, second = (await buttons.nth(1).boundingBox())!;
    expect(second.x - first.x - first.width).toBeGreaterThanOrEqual(9);
    await page.screenshot({ path: `artifacts/passage-path-${width}.png`, fullPage: true });
  }
  // WebView 74 ignores max() in padding; parse the real rule with that declaration unsupported.
  const rootRule = readFileSync(new URL("../../src/modes/passage-path/style.css", import.meta.url), "utf8").split("\n")[0]!;
  const fallbackStyle = await page.addStyleTag({ content: rootRule.replace("max(", "unsupported-max(") });
  await expect(page.locator(".passage-path-mode")).toHaveCSS("padding-left", "16px");
  await expect(page.locator(".passage-path-mode")).toHaveCSS("padding-right", "16px");
  await fallbackStyle.evaluate(element => { element.parentNode!.removeChild(element); });
  await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  expect(await page.locator(".seven-step-mode").evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(242, 246, 241)");
  expect(await page.locator(".seven-step-mode .topbar").evaluate(element => getComputedStyle(element).display)).toBe("flex");
  const leaks = await page.evaluate(() => {
    const leaks: string[] = [];
    const visit = (rules: CSSRuleList) => { for (const rule of rules) {
      if (rule instanceof CSSStyleRule && rule.selectorText.split(",").some(selector => !selector.trim().startsWith(".passage-path-mode"))) leaks.push(rule.selectorText);
      else if ("cssRules" in rule) visit((rule as CSSMediaRule).cssRules);
    } };
    const styles = [...document.querySelectorAll<HTMLStyleElement>("style[data-vite-dev-id]")].filter(style => style.dataset.viteDevId?.replaceAll("\\", "/").endsWith("/passage-path/style.css"));
    if (styles.length !== 1) leaks.push("missing passage stylesheet");
    styles.forEach(style => visit(style.sheet!.cssRules)); return leaks;
  });
  expect(leaks).toEqual([]);
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
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "继续学习", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "课文原文", exact: true }).click();
  await expect(page.locator(".passage-original")).toBeVisible();
});

test("new material edits must save before leaving and remain shared without publishing seven-step content", async ({ page }) => {
  await seed(page); await page.goto("/"); await parent(page);
  await page.getByRole("button", { name: "新建教材", exact: true }).click();
  await page.getByLabel("课程标题", { exact: true }).fill("闯关新增教材草稿");
  await page.getByLabel("已确认课文", { exact: true }).fill("Hello, my friend.");
  await page.evaluate(() => { (window as any).__saveFailure = true; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("闯关新增教材草稿");
  await page.evaluate(() => { (window as any).__saveFailure = false; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  const saved = await oldState(page), draft = saved.courses.find((course: { title: string }) => course.title === "闯关新增教材草稿");
  expect(draft.status).toBe("source"); expect(draft.package).toBeNull();
  expect(saved.events).toEqual(legacy.snapshot.events); expect(saved.runs).toEqual(legacy.snapshot.runs);
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("闯关新增教材草稿");
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
      await expect(page.locator(".passage-practice .eyebrow")).toContainText(record.title);
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
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByLabel("当前孩子").selectOption("legacy-b");
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
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
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
  expect((await state(page)).sessions[0]!.queue).toHaveLength(8);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
