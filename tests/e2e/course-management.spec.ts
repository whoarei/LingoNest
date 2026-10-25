import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { navigate, parentSpace } from "./fixtures/application";
async function boot(page: Page) {
  for (const [target, fixture] of [
    ["native", "speech-native"],
    ["platform/content", "course-content"],
  ])
    await page.route(`**/src/${target}.ts`, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: readFileSync(
          new URL(`./fixtures/${fixture}.js`, import.meta.url),
          "utf8",
        ),
      }),
    );
  await page.goto("/");
  await page.getByLabel("先给自己起个昵称").fill("课程测试");
  await page.getByRole("button", { name: "建立我的小窝" }).click(); await adult(page);
  await parentSpace(page);
  await page.getByRole("button", { name: "课程", exact: true }).click();
}
async function adult(page: Page) {
  if (await page.getByLabel("7加5的答案").count()) {
    await page.getByLabel("7加5的答案").fill("12");
    await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  }
}
async function newDraft(page: Page) {
  await page.getByRole("button", { name: "新建课程", exact: true }).click();
  await adult(page);
  await page.getByLabel("课程标题", { exact: true }).fill("My Family");
}
async function openCourse(page: Page, title: string) {
  await navigate(page, "课程");
  await page.locator(".frame-course-entry").filter({ hasText: title }).click();
  await page.locator(".frame-list-row").filter({ hasText: "七步" }).getByRole("button", { name: "准备／查看内容", exact: true }).click();
}
async function back(page: Page) {
  await page.evaluate(() => (window as any).__nativeBack());
}
async function original(page: Page) {
  if (await page.getByRole("button", { name: "保存教材", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "保存教材", exact: true }).click();
    await page.getByRole("button", { name: "返回课程详情", exact: true }).click();
    await page.locator(".frame-list-row").filter({ hasText: "七步" }).getByRole("button", { name: "准备／查看内容", exact: true }).click();
  }
  await page
    .getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。")
    .check();
  await page
    .getByRole("button", { name: "确认原文，整理重点词汇", exact: true })
    .click();
  await adult(page);
  await expect(
    page.getByRole("heading", { name: "整理并确认重点词汇", exact: true }),
  ).toBeVisible();
}
async function prepareReview(page: Page) {
  await page
    .getByRole("button", { name: "确认词汇，继续生成课程", exact: true })
    .click();
  await adult(page);
  await page
    .getByRole("button", { name: "生成本课学习内容", exact: true })
    .click();
  await adult(page);
  await expect(
    page.getByRole("heading", { name: "审核学习内容", exact: true }),
  ).toBeVisible();
}
async function publish(page: Page) {
  await prepareReview(page);
  await page
    .getByRole("button", { name: "审核通过，启用课程", exact: true })
    .isDisabled()
    .then((disabled) => expect(disabled).toBe(true));
  await page
    .getByLabel("已核对释义、重点词汇、题目和答案，确认可以交给孩子学习。")
    .check();
  await page
    .getByRole("button", { name: "审核通过，启用课程", exact: true })
    .click();
  await adult(page);
  await expect(page.locator(".course-audio-panel")).toContainText("My Family");
}
async function state(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      JSON.parse(sessionStorage.getItem("speech-native-fixture")!).payload,
    ),
  );
}
async function deletionWork(page: Page) {
  return page.evaluate(() => {
    const saved = sessionStorage.getItem("native-document:lingonest.deletions.v2");
    return saved ? JSON.parse(JSON.parse(saved).payload) : { plans: [], completed: [] };
  });
}

test("typed material becomes a playable seven-step course while the starter and both learning histories stay independent", async ({ page }) => {
  await boot(page); await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.\nMy mother is a teacher.");
  await original(page);
  await page.getByRole("button", { name: "应用生成重点词汇", exact: true }).click();
  await page.getByRole("button", { name: "编辑词条 1：family", exact: true }).click();
  await page.getByLabel("释义 1", { exact: true }).fill("家人、家庭");
  await page.getByRole("button", { name: "保存词汇草稿", exact: true }).click();
  await expect.poll(async () => (await state(page)).courses[0].vocabulary[0].meaning).toBe("家人、家庭");
  await page.reload(); await parentSpace(page); await openCourse(page, "My Family");
  await publish(page);
  expect((await state(page)).courses[0].package.exercises.map((item: any) => item.stageId)).toEqual(expect.arrayContaining(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]));
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await navigate(page, "课程"); await page.locator(".frame-course-entry").filter({ hasText: "My Family" }).click();
  await page.getByRole("button", { name: "先来认识这篇课文", exact: true }).click();
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "确认课文，准备学习", exact: true }).click();
  await page.getByRole("button", { name: "回到学习路线", exact: true }).click();
  await page.getByRole("button", { name: "继续读懂故事", exact: true }).click();
  await page.locator(".choice-option").filter({ hasText: "老师" }).click();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "做到了，继续保持！" })).toBeVisible();
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByRole("button", { name: "保存进度并退出", exact: true }).click();
  await navigate(page, "课程"); await page.locator(".frame-course-entry").filter({ hasText: "一起加入运动队" }).click();
  await parentSpace(page); await navigate(page, "记录");
  await page.getByRole("button", { name: /七步.*报告/ }).click();
  await expect(page.getByRole("heading", { name: "这项能力还没有作答记录" })).toBeVisible();
  expect((await state(page)).events.filter((item: any) => item.type === "attempt")).toHaveLength(1);
});

test("photographed material is corrected in the frame and vocabulary provenance stays in the seven-step plugin", async ({ page }) => {
  await boot(page); await newDraft(page);
  await page.getByRole("button", { name: "拍摄课文", exact: true }).click();
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.getByRole("button", { name: "旋转", exact: true }).first().click();
  await page.getByRole("button", { name: "前移", exact: true }).last().click();
  await page.evaluate(() => { (window as any).__ocrUncertain = true; });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await expect(page.getByLabel("文章或课文原文", { exact: true })).toHaveValue(/待校对/);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.\nMy mother is a teacher.");
  await page.getByRole("button", { name: "拍摄词汇表", exact: true }).click();
  await original(page);
  await page.getByRole("button", { name: "识别教材词汇表", exact: true }).click();
  await expect(page.locator(".course-word")).toHaveCount(2);
  await page.getByRole("button", { name: "应用生成重点词汇", exact: true }).click();
  await expect(page.locator(".course-word")).toHaveCount(3);
  expect((await state(page)).courses[0].vocabulary.map((word: any) => word.origin)).toEqual(["photo", "photo", "auto"]);
  await publish(page);
  expect((await state(page)).courses[0].images.map((image: any) => image.rotation)).toEqual([0, 90]);
});

test("course review presents readable sections and preserves edits and approval safeguards", async ({ page }) => {
  await boot(page);
  await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.\nMy mother is a teacher.");
  await original(page);
  await page.getByRole("button", { name: "应用生成重点词汇", exact: true }).click();
  await adult(page);
  await prepareReview(page);
  const review = page.locator(".course-review");
  const approval = page.getByLabel("已核对释义、重点词汇、题目和答案，确认可以交给孩子学习。");
  const publishButton = page.getByRole("button", { name: "审核通过，启用课程", exact: true });
  await expect(review.locator("textarea,input,select")).toHaveCount(0);
  await expect(review.locator(".course-review-card")).toHaveCount(2);
  await expect(publishButton).toBeDisabled();
  await review.locator(".course-review-vocabulary summary").click();
  await expect(review.locator(".course-review-word-chips")).toContainText("family");
  await review.locator(".course-review-vocabulary summary").click();
  await page.screenshot({ path: "artifacts/screenshots/course-review-reading-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "编辑第 1 段释义", exact: true }).click();
  await page.getByLabel("第 1 段释义", { exact: true }).fill("我爱我的家人。");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(review.locator(".course-review-translation").first()).toContainText("我爱我的家人。");
  await page.getByRole("button", { name: "理解题", exact: true }).click();
  await expect(review.locator(".course-review-options .correct")).toContainText("老师");
  await page.screenshot({ path: "artifacts/screenshots/course-review-question-mobile.png", fullPage: true });
  await approval.check();
  await page.getByRole("button", { name: "编辑理解题 1", exact: true }).click();
  await page.getByLabel("问题 1", { exact: true }).fill("妈妈做什么工作？");
  await expect(approval).not.toBeChecked();
  await expect(publishButton).toBeDisabled();
  await page.getByLabel("选项 2", { exact: true }).fill("工程师");
  await page.getByLabel("正确选项 1", { exact: true }).selectOption("1");
  await page.getByLabel("解释 1", { exact: true }).fill("测试人工修改答案。");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(review.locator(".course-review-options .correct")).toContainText("工程师");
  await page.getByRole("button", { name: "情境应用", exact: true }).click();
  await page.getByRole("button", { name: "编辑情境应用 1", exact: true }).click();
  await page.getByLabel("应用任务 1", { exact: true }).fill("用 I love 表达你爱自己的学校。");
  await page.getByLabel("可接受答案 1（每行一个）", { exact: true }).fill("I love my school.\nI love our school.");
  await page.getByLabel("应用提示 1", { exact: true }).fill("注意学校的英文表达。");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await expect(review.locator(".course-review-answers p")).toHaveCount(2);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "artifacts/screenshots/course-review-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/screenshots/course-review-application-mobile.png", fullPage: true });
  await expect.poll(async () => (await state(page)).courses[0].recipe.applications[0].answers.length).toBe(2);
  const saved = (await state(page)).courses[0];
  expect(saved.sourceText).toBe("I love my family.\nMy mother is a teacher.");
  expect(saved.recipe.translations[0]).toBe("我爱我的家人。");
  expect(saved.recipe.comprehension[0]).toMatchObject({ question: "妈妈做什么工作？", answerIndex: 1 });
  await page.reload();
  await parentSpace(page);
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family");
  await expect(review.locator(".course-review-translation").first()).toContainText("我爱我的家人。");
  await page.getByRole("button", { name: "理解题", exact: true }).click();
  await expect(review.locator(".course-review-options .correct")).toContainText("工程师");
  await expect(approval).not.toBeChecked();
  await page.locator(".course-review-preview summary").click();
  await expect(page.locator(".course-review-preview")).toContainText("I love our school.");
});

test("visiting preparation steps keeps generated work but editing shared material invalidates unpublished content", async ({ page }) => {
  await boot(page); await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.\nMy mother is a teacher.");
  await original(page); await page.getByRole("button", { name: "应用生成重点词汇", exact: true }).click(); await prepareReview(page);
  const before = (await state(page)).courses[0].recipe;
  await page.getByRole("button", { name: "第 2 步：重点词汇", exact: true }).click();
  await page.getByRole("button", { name: "第 4 步：审核课程", exact: true }).click();
  expect((await state(page)).courses[0].recipe).toEqual(before);
  await page.getByRole("button", { name: "返回课程详情", exact: true }).click();
  await page.getByRole("button", { name: "教材", exact: true }).click();
  await page.getByRole("button", { name: "编辑教材", exact: true }).click();
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.\nMy father is a teacher.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await navigate(page, "课程"); await openCourse(page, "My Family");
  await expect(page.getByRole("heading", { name: "核对课程教材", exact: true })).toBeVisible();
  const saved = (await state(page)).courses[0]; expect(saved.status).toBe("source"); expect(saved.recipe).toBeNull(); expect(saved.package).toBeNull();
});

test("save failure retains the editor and generation prevents navigation until cancellation", async ({ page }) => {
  await boot(page); await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family."); await original(page);
  await page.evaluate(() => { (window as any).__contentDelay = 500; });
  await page.getByRole("button", { name: "应用生成重点词汇", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "家长导航" }).getByRole("button", { name: "设置", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "停止处理", exact: true }).click();
  await page.waitForTimeout(550); expect((await state(page)).courses[0].vocabulary).toHaveLength(0);
  await page.getByRole("button", { name: "补充词汇", exact: true }).click();
  await page.getByLabel("词条 1", { exact: true }).fill("family"); await page.getByLabel("释义 1", { exact: true }).fill("家庭");
  await page.evaluate(() => { (window as any).__saveFailure = true; }); await navigate(page, "设置", false);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "整理并确认重点词汇", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__saveFailure = false; }); await navigate(page, "设置");
  await expect(page.getByRole("radiogroup")).toBeVisible();
});

test("compact vocabulary preserves selection and edits, adds and removes entries, and opens incomplete words", async ({ page }) => {
  await boot(page);
  await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.");
  await page.getByRole("button", { name: "选择词汇表图片", exact: true }).click();
  await original(page);
  await page.evaluate(() => {
    const terms = ["family", "teacher", "mother", "father", "sister", "brother", "school", "home", "book", "pencil", "garden", "tree", "flower", "bird", "cat", "dog", "apple", "orange", "water", "milk", "bread", "friend", "student", "classroom"];
    (window as any).__vocabularyEntries = terms.map((term, index) => ({
      term, meaning: index === 2 ? "" : `词义 ${index + 1}`, example: "",
    }));
  });
  await page.getByRole("button", { name: "识别教材词汇表", exact: true }).click();
  await expect(page.locator(".vocabulary-item")).toHaveCount(24);
  await expect(page.locator(".vocabulary-editor")).toHaveCount(0);
  await expect(page.locator(".vocabulary-count")).toContainText("已选 24 / 24");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/screenshots/vocabulary-compact-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "编辑词条 1：family", exact: true }).click();
  await page.getByLabel("释义 1", { exact: true }).fill("家人、家庭");
  await page.getByLabel("例句 1（可选）", { exact: true }).fill("I love my family.");
  await page.getByRole("button", { name: "编辑词条 2：teacher", exact: true }).click();
  await expect(page.getByLabel("词条 1", { exact: true })).toHaveCount(0);
  await expect(page.locator(".vocabulary-editor")).toHaveCount(1);
  await page.getByRole("button", { name: "删除词条 2", exact: true }).click();
  await page.getByLabel("纳入重点词汇 1", { exact: true }).uncheck();
  await expect(page.locator(".vocabulary-count")).toContainText("已选 22 / 23");
  await page.getByRole("button", { name: "补充词汇", exact: true }).click();
  await expect(page.getByLabel("词条 24", { exact: true })).toBeFocused();
  await page.getByLabel("词条 24", { exact: true }).fill("notebook");
  await page.getByLabel("释义 24", { exact: true }).fill("笔记本");
  await page.getByRole("button", { name: "确认词汇，继续生成课程", exact: true }).click();
  await expect(page.getByLabel("释义 2", { exact: true })).toBeFocused();
  await page.getByLabel("释义 2", { exact: true }).fill("妈妈");
  await page.screenshot({ path: "artifacts/screenshots/vocabulary-editor-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".vocabulary-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "保存词汇草稿", exact: true }).click();
  await expect.poll(async () => (await state(page)).courses[0].vocabulary[0].meaning).toBe("家人、家庭");
  const saved = (await state(page)).courses[0].vocabulary;
  expect(saved).toHaveLength(24);
  expect(saved[0]).toMatchObject({ term: "family", meaning: "家人、家庭", example: "I love my family.", selected: false, origin: "photo" });
  expect(saved[1]).toMatchObject({ term: "mother", meaning: "妈妈", selected: true });
  expect(saved[23]).toMatchObject({ term: "notebook", meaning: "笔记本", origin: "manual" });
  await page.reload();
  await parentSpace(page);
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family");
  await expect(page.locator(".vocabulary-editor")).toHaveCount(0);
  await expect(page.getByLabel("纳入重点词汇 1", { exact: true })).not.toBeChecked();
  expect((await state(page)).courses[0].vocabulary).toEqual(saved);
});

test("OCR fills empty metadata and public material edits persist across reload", async ({ page }) => {
  await boot(page); await newDraft(page); await page.getByLabel("课程标题", { exact: true }).fill("");
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("My Family");
  await expect(page.getByLabel("教材或单元（可选）", { exact: true })).toHaveValue("Unit 2 · Lesson 1");
  await page.getByLabel("课程标题", { exact: true }).fill("我们的家庭");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect.poll(async () => (await state(page)).courses[0]?.title).toBe("我们的家庭");
  await page.reload(); await parentSpace(page); await openCourse(page, "我们的家庭");
  await expect(page.getByRole("heading", { name: "核对课程教材", exact: true })).toBeVisible();
  expect((await state(page)).courses[0].title).toBe("我们的家庭");
  expect((await state(page)).courses[0].status).toBe("source");
});

test("OCR preserves existing metadata and adoption stays local to the current material draft", async ({ page }) => {
  await boot(page); await newDraft(page);
  await page.getByLabel("课程标题", { exact: true }).fill("人工标题"); await page.getByLabel("教材或单元（可选）", { exact: true }).fill("人工课次");
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click(); await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("人工标题");
  await page.getByRole("button", { name: "采用识别标题", exact: true }).click(); await page.getByRole("button", { name: "采用识别教材或单元", exact: true }).click();
  await expect(page.getByLabel("课程标题", { exact: true })).toHaveValue("My Family");
  await navigate(page, "课程"); await newDraft(page);
  await expect(page.getByRole("button", { name: "采用识别标题", exact: true })).toHaveCount(0);
});

test("multiline OCR keeps existing material until the parent explicitly adopts its replacement", async ({ page }) => {
  await boot(page); await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("Keep this original.");
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.evaluate(() => { (window as any).__ocrLiteralLineBreaks = true; });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await expect(page.getByLabel("文章或课文原文", { exact: true })).toHaveValue("Keep this original.");
  await page.getByRole("button", { name: "采用识别结果替换当前草稿", exact: true }).click();
  await expect(page.getByLabel("文章或课文原文", { exact: true })).toHaveValue("I love my family.\nMy mother is a teacher.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click();
  await expect.poll(async () => (await state(page)).courses[0]?.sourceText).toBe("I love my family.\nMy mother is a teacher.");
  expect((await state(page)).courses[0].sourceText).toBe("I love my family.\nMy mother is a teacher.");
});

test("failed generation preserves a resumable draft, malformed output cannot publish and stopping a request discards late results", async ({
  page,
}) => {
  await boot(page);
  await newDraft(page);
  await page
    .getByLabel("文章或课文原文", { exact: true })
    .fill("I love my family.");
  await original(page);
  await page.evaluate(() => {
    (window as any).__contentFailure = true;
  });
  await page
    .getByRole("button", { name: "应用生成重点词汇", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "草稿保留" }),
  ).toBeVisible();
  expect((await state(page)).courses[0].status).toBe("vocabulary");
  await page.evaluate(() => {
    (window as any).__contentFailure = false;
    (window as any).__contentMalformed = true;
  });
  await page
    .getByRole("button", { name: "应用生成重点词汇", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "词汇清单" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).__contentMalformed = false;
    (window as any).__contentDelay = 500;
  });
  await page
    .getByRole("button", { name: "应用生成重点词汇", exact: true })
    .click();
  await page.getByRole("button", { name: "停止处理", exact: true }).click();
  await page.waitForTimeout(550);
  await expect(page.locator(".course-word")).toHaveCount(0);
  expect((await state(page)).courses[0].status).toBe("vocabulary");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByLabel("课程生成 API Key", { exact: true })
    .fill("fake-course-key");
  await page
    .getByRole("button", { name: "仅保存课程生成配置", exact: true })
    .click();
  await expect(
    page.getByLabel("课程生成 API Key", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "返回内容准备", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "整理并确认重点词汇", exact: true }),
  ).toBeVisible();
});

test("course audio is prepared inside course management and each course keeps independent resources", async ({
  page,
}) => {
  await boot(page);
  await newDraft(page);
  await page
    .getByLabel("文章或课文原文", { exact: true })
    .fill("I love my family.\nMy mother is a teacher.");
  await original(page);
  await page
    .getByRole("button", { name: "应用生成重点词汇", exact: true })
    .click();
  await publish(page);
  await page
    .getByRole("button", { name: "去设置配置语音模型", exact: true })
    .click();
  await page.getByLabel("朗读方式").selectOption("ai");
  await page
    .getByRole("button", { name: "小米 MiMo 配置", exact: true })
    .click();
  await page.getByLabel("API Key", { exact: true }).fill("fake-speech-key");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.locator(".course-audio-panel")).not.toBeVisible();
  await page.getByRole("button", { name: "返回内容准备", exact: true }).click();
  await expect(page.locator(".course-audio-panel")).toContainText("My Family");
  await page
    .getByRole("button", { name: "生成 / 继续整课音频", exact: true })
    .click();
  await adult(page);
  await expect(
    page.getByText("整课音频已保存为课程资源，可以反复离线学习。"),
  ).toBeVisible();
  const afterNew = await page.evaluate(() => (window as any).__speechRequests);
  expect(afterNew).toBeGreaterThan(0);
  expect(afterNew).toBeLessThan(44);
  await openCourse(page, "一起加入运动队");
  await expect(page.locator(".course-audio-panel")).toContainText("0 / 44");
  await page
    .getByRole("button", { name: "生成 / 继续整课音频", exact: true })
    .click();
  await adult(page);
  await expect(page.locator(".course-audio-panel")).toContainText("44 / 44");
  expect(await page.evaluate(() => (window as any).__speechRequests)).toBe(
    afterNew + 44,
  );
  await openCourse(page, "My Family");
  await page.getByRole("button", { name: "删除本课音频", exact: true }).click();
  await page
    .getByRole("button", { name: "确认删除本课音频", exact: true })
    .click();
  await adult(page);
  await expect(page.locator(".course-audio-panel")).toContainText("0 /");
  await openCourse(page, "一起加入运动队");
  await expect(page.locator(".course-audio-panel")).toContainText("44 / 44");
});

test("shared course detail and plugin editing return to the correct destination through settings and native back", async ({ page }) => {
  await boot(page); await newDraft(page); await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await original(page); await navigate(page, "设置"); await back(page);
  await expect(page.getByRole("heading", { name: "整理并确认重点词汇", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回课程详情", exact: true }).click();
  await navigate(page, "设置"); await back(page);
  await expect(page.getByRole("heading", { name: "My Family", exact: true })).toBeVisible();
  await back(page); await expect(page.getByRole("heading", { name: "课程管理", exact: true })).toBeVisible();
});

test("draft deletion preserves content on save failure and can be restored after reload", async ({ page }) => {
  await boot(page); await newDraft(page); await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click(); await page.getByRole("button", { name: "返回课程详情", exact: true }).click();
  await page.evaluate(() => { (window as any).__saveFailure = true; }); await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("模拟保存失败");
  expect((await state(page)).courses[0].deletedAt).toBeUndefined();
  await page.evaluate(() => { (window as any).__saveFailure = false; }); await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await expect(page.getByRole("heading", { name: "课程管理", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload(); await parentSpace(page); await navigate(page, "课程");
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await page.getByRole("button", { name: "恢复课程", exact: true }).click();
  await expect.poll(async () => (await state(page)).courses[0].deletedAt).toBeUndefined();
  expect((await state(page)).courses[0].sourceText).toBe("Hello, my friend.");
  expect((await state(page)).courses[0].deletedAt).toBeUndefined();
});

test("published course archive and restore preserve progress while permanent purge removes its data", async ({ page }) => {
  await boot(page); await newDraft(page); await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.");
  await original(page); await page.getByRole("button", { name: "应用生成重点词汇", exact: true }).click(); await publish(page);
  const before = (await state(page)).courses[0];
  await page.getByRole("button", { name: "返回课程详情", exact: true }).click(); await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click(); await page.getByRole("button", { name: "恢复课程", exact: true }).click();
  expect((await state(page)).courses[0].package).toEqual(before.package);
  await page.getByRole("button", { name: "课程列表", exact: true }).click();
  await page.locator(".frame-course-entry").filter({ hasText: "My Family" }).click(); await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click(); await page.getByRole("button", { name: "彻底删除", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认删除", exact: true })).toBeDisabled();
  await page.getByLabel("输入名称确认", { exact: true }).fill("My Family"); await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect.poll(async () => (await state(page)).courses.length).toBe(0);
  expect((await deletionWork(page)).completed.length).toBeGreaterThan(0);
});

test("shared course list supports short and long swipes without turning vertical scroll into deletion", async ({ page }) => {
  await boot(page); await newDraft(page); await page.getByLabel("文章或课文原文", { exact: true }).fill("Hello, my friend.");
  await page.getByRole("button", { name: "保存教材", exact: true }).click(); await navigate(page, "课程");
  const row = page.locator(".swipe-course-row").filter({ hasText: "My Family" });
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 25, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + box.width - 90, box.y + 30, { steps: 6 }); await page.mouse.up();
  await expect(row.locator(".swipe-course-content")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -88, 0)");
  expect((await state(page)).courses[0].deletedAt).toBeUndefined();
  await row.getByRole("button", { name: "删除课程：My Family", exact: true }).click();
  await expect.poll(async () => !!(await state(page)).courses[0].deletedAt).toBe(true);
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click(); await page.getByRole("button", { name: "恢复课程", exact: true }).click();
  await page.getByRole("button", { name: "课程列表", exact: true }).click();
  const restored = (await row.boundingBox())!;
  await page.mouse.move(restored.x + restored.width - 25, restored.y + 30); await page.mouse.down(); await page.mouse.move(restored.x + 10, restored.y + 30, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => !!(await state(page)).courses[0].deletedAt).toBe(true);
});

test("native back closes application subpages before exiting the learning root", async ({ page }) => {
  await boot(page); await navigate(page, "设置"); await back(page);
  await expect(page.getByRole("heading", { name: "课程管理", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await navigate(page, "记录"); await back(page);
  await expect(page.getByRole("button", { name: "先来认识这篇课文" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
});
