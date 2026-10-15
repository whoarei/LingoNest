import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
async function boot(page: Page) {
  for (const [target, fixture] of [
    ["native", "speech-native"],
    ["content", "course-content"],
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
  await page.getByRole("button", { name: "建立我的小窝" }).click();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
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
  const back = page.getByRole("button", { name: "返回课程列表", exact: true });
  if (await back.isVisible()) await back.click();
  await page.locator(".course-list button").filter({ hasText: title }).click();
}
async function back(page: Page) {
  await page.evaluate(() => (window as any).__nativeBack());
}
async function original(page: Page) {
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
async function publish(page: Page) {
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

test("typed article, automatic vocabulary, review and assignment create a second playable course and preserve the starter", async ({
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
  await adult(page);
  await page.getByRole("button", { name: "编辑词条 1：family", exact: true }).click();
  await expect(page.getByLabel("词条 1", { exact: true })).toHaveValue(
    "family",
  );
  await page.getByLabel("释义 1", { exact: true }).fill("家人、家庭");
  await page.getByRole("button", { name: "保存词汇草稿", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await page
    .locator(".course-list button")
    .filter({ hasText: "My Family" })
    .click();
  await page.getByRole("button", { name: "编辑词条 1：family", exact: true }).click();
  await expect(page.getByLabel("释义 1", { exact: true })).toHaveValue(
    "家人、家庭",
  );
  await publish(page);
  let snapshot = await state(page);
  expect(snapshot.courses).toHaveLength(1);
  expect(snapshot.learningCourseIds).toEqual({});
  expect(
    snapshot.courses[0].package.exercises.map((item: any) => item.stageId),
  ).toEqual(expect.arrayContaining(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]));
  await page
    .getByRole("button", { name: "设为当前孩子的学习课程", exact: true })
    .click();
  await adult(page);
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await expect(page.locator(".hero-copy")).toContainText("My Family");
  await page.getByRole("button", { name: "继续读懂故事", exact: true }).click();
  await page.locator(".choice-option").filter({ hasText: "老师" }).click();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "做到了，继续保持！" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保存进度并切换", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "一起加入运动队");
  await page
    .getByRole("button", { name: "设为当前孩子的学习课程", exact: true })
    .click();
  await adult(page);
  await page.getByRole("button", { name: "报告", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这项能力还没有作答记录" }),
  ).toBeVisible();
  snapshot = await state(page);
  expect(
    snapshot.events.filter((event: any) => event.type === "attempt"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await page
    .locator(".course-list button")
    .filter({ hasText: "My Family" })
    .click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "artifacts/screenshots/course-library-desktop.png",
    fullPage: true,
  });
});

test("photographed original is corrected before vocabulary, photo and automatic word lists merge with their provenance", async ({
  page,
}) => {
  await boot(page);
  await newDraft(page);
  await page.getByRole("button", { name: "拍摄课文", exact: true }).click();
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await expect(page.locator(".course-source-grid article")).toHaveCount(2);
  await page.getByRole("button", { name: "旋转", exact: true }).first().click();
  await page.getByRole("button", { name: "前移", exact: true }).last().click();
  await page.evaluate(() => {
    (window as any).__ocrUncertain = true;
  });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await adult(page);
  await expect(page.getByLabel("文章或课文原文", { exact: true })).toHaveValue(
    /待校对/,
  );
  await page
    .getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。")
    .check();
  await page
    .getByRole("button", { name: "确认原文，整理重点词汇", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "待校对" }),
  ).toBeVisible();
  await page
    .getByLabel("文章或课文原文", { exact: true })
    .fill("I love my family.\nMy mother is a teacher.");
  await original(page);
  await page.getByRole("button", { name: "拍摄词汇表", exact: true }).click();
  await page
    .getByRole("button", { name: "识别教材词汇表", exact: true })
    .click();
  await expect(page.locator(".course-word")).toHaveCount(2);
  await page
    .getByRole("button", { name: "应用生成重点词汇", exact: true })
    .click();
  await expect(page.locator(".course-word")).toHaveCount(3);
  expect(
    (await state(page)).courses[0].vocabulary.map((word: any) => word.origin),
  ).toEqual(["photo", "photo", "auto"]);
  await page.screenshot({
    path: "artifacts/screenshots/course-vocabulary-mobile.png",
    fullPage: true,
  });
  await publish(page);
  expect(
    (await state(page)).courses[0].images.map((image: any) => image.rotation),
  ).toEqual([0, 90]);
});

test("compact vocabulary preserves selection and edits, adds and removes entries, and opens incomplete words", async ({ page }) => {
  await boot(page);
  await newDraft(page);
  await page.getByLabel("文章或课文原文", { exact: true }).fill("I love my family.");
  await original(page);
  await page.getByRole("button", { name: "选择词汇表图片", exact: true }).click();
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
  const saved = (await state(page)).courses[0].vocabulary;
  expect(saved).toHaveLength(24);
  expect(saved[0]).toMatchObject({ term: "family", meaning: "家人、家庭", example: "I love my family.", selected: false, origin: "photo" });
  expect(saved[1]).toMatchObject({ term: "mother", meaning: "妈妈", selected: true });
  expect(saved[23]).toMatchObject({ term: "notebook", meaning: "笔记本", origin: "manual" });
  await page.reload();
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family");
  await expect(page.locator(".vocabulary-editor")).toHaveCount(0);
  await expect(page.getByLabel("纳入重点词汇 1", { exact: true })).not.toBeChecked();
  expect((await state(page)).courses[0].vocabulary).toEqual(saved);
});

test("OCR fills blank metadata, saves edits and requires confirmation of the final fields", async ({ page }) => {
  await boot(page);
  await newDraft(page);
  const title = page.getByLabel("课程标题", { exact: true });
  const subtitle = page.getByLabel("教材或单元（可选）", { exact: true });
  await title.fill("");
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await adult(page);
  await expect(title).toHaveValue("My Family");
  await expect(subtitle).toHaveValue("Unit 2 · Lesson 1");
  const confirm = page.getByRole("button", { name: "确认原文，整理重点词汇", exact: true });
  const checked = page.getByLabel("已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。");
  await expect(confirm).toBeDisabled();
  await checked.check();
  await subtitle.fill("English Book · Unit 2 · Lesson 1");
  await expect(checked).not.toBeChecked();
  await title.fill("My Family — 校对版");
  await expect.poll(async () => (await state(page)).courses[0].subtitle).toBe("English Book · Unit 2 · Lesson 1");
  await page.reload();
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family — 校对版");
  await expect(title).toHaveValue("My Family — 校对版");
  await expect(subtitle).toHaveValue("English Book · Unit 2 · Lesson 1");
  await original(page);
});

test("OCR preserves existing metadata and offers explicit adoption without leaking suggestions to a new draft", async ({ page }) => {
  await boot(page);
  await newDraft(page);
  const title = page.getByLabel("课程标题", { exact: true });
  const subtitle = page.getByLabel("教材或单元（可选）", { exact: true });
  await subtitle.fill("我的教材");
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__ocrMetadata = { title: "Recognized Lesson", subtitle: "Lesson 3" };
  });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await adult(page);
  await expect(title).toHaveValue("My Family");
  await expect(subtitle).toHaveValue("我的教材");
  await expect(page.getByRole("button", { name: "采用识别标题", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "采用识别教材或单元", exact: true }).click();
  await expect(subtitle).toHaveValue("Lesson 3");
  await expect(title).toHaveValue("My Family");
  await page.getByRole("button", { name: "返回课程列表", exact: true }).click();
  await newDraft(page);
  await expect(subtitle).toHaveValue("");
  await expect(page.getByRole("button", { name: "采用识别标题", exact: true })).toHaveCount(0);
  await title.fill("");
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.evaluate(() => { (window as any).__ocrMetadata = {}; });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await adult(page);
  await expect(page.getByLabel("文章或课文原文", { exact: true })).toHaveValue(/I love my family/);
  await expect(title).toHaveValue("");
  await expect(subtitle).toHaveValue("");
});

test("multiline OCR fills the original, survives reload and requires adoption before replacing existing text", async ({ page }) => {
  await boot(page);
  await newDraft(page);
  await page.getByRole("button", { name: "选择课文图片", exact: true }).click();
  await page.evaluate(() => { (window as any).__ocrLiteralLineBreaks = true; });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await adult(page);
  const original = page.getByLabel("文章或课文原文", { exact: true });
  const text = "I love my family.\nMy mother is a teacher.";
  await expect(original).toHaveValue(text);
  await expect.poll(async () => (await state(page)).courses[0].sourceText).toBe(text);
  await page.reload();
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family");
  await expect(original).toHaveValue(text);
  await original.fill("My corrected article.");
  await page.evaluate(() => { (window as any).__ocrLiteralLineBreaks = true; });
  await page.getByRole("button", { name: "识别课文图片", exact: true }).click();
  await adult(page);
  await expect(page.getByLabel("新的识别结果", { exact: true })).toHaveValue(text);
  await expect(original).toHaveValue("My corrected article.");
  await page.getByRole("button", { name: "采用识别结果替换当前草稿", exact: true }).click();
  await expect(original).toHaveValue(text);
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
    .getByRole("button", { name: "保存课程生成配置", exact: true })
    .click();
  await expect(
    page.getByLabel("课程生成 API Key", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
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
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
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

test("course list opens a separate detail page and every settings return restores the parent destination", async ({
  page,
}) => {
  await boot(page);
  await expect(page.getByRole("button", { name: /^已删除/ })).toHaveCount(0);
  await expect(page.locator(".course-detail-page")).toHaveCount(0);
  await expect(page.locator(".course-audio-panel")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/screenshots/course-list-mobile.png",
    fullPage: true,
  });
  await openCourse(page, "一起加入运动队");
  await expect(page.locator(".course-library-page")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "删除课程", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await back(page);
  await expect(page.locator(".course-detail-page")).toBeVisible();
  await expect(page.getByLabel("家长导航")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await expect(page.locator(".course-detail-page")).toBeVisible();
  await back(page);
  await expect(page.locator(".course-library-page")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await back(page);
  await expect(page.locator(".course-library-page")).toBeVisible();
  await page.getByRole("button", { name: "报告", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await back(page);
  await expect(
    page.getByRole("heading", { name: "学习报告", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => !!(window as any).__appExited)).toBe(false);
});

test("draft deletion needs no confirmation, preserves content on save failure and can undo after reload", async ({
  page,
}) => {
  await boot(page);
  await newDraft(page);
  await page
    .getByLabel("文章或课文原文", { exact: true })
    .fill("I love my family.");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__saveFailure = true;
  });
  await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "保存未完成" }),
  ).toBeVisible();
  expect((await state(page)).courses).toHaveLength(1);
  expect(
    await page.evaluate(() => (window as any).__deletedResources),
  ).toBeUndefined();
  await page.evaluate(() => {
    (window as any).__saveFailure = false;
  });
  await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await expect(page.locator(".course-library-page")).toBeVisible();
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(800);
  expect((await state(page)).courses[0].deletedAt).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await expect(page.locator(".course-list-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await expect(page.locator(".deleted-course-row")).toContainText("My Family");
  await page.getByRole("button", { name: "恢复课程", exact: true }).click();
  await expect(page.locator(".deleted-course-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^已删除/ })).toHaveCount(0);
  await expect(page.locator(".course-list-entry")).toHaveCount(2);
  await page.getByRole("button", { name: "课程列表", exact: true }).click();
  await openCourse(page, "My Family");
  await expect(page.getByLabel("文章或课文原文", { exact: true })).toHaveValue(
    "I love my family.",
  );
});

test("published course can restore its progress, then purge permanently with atomic save and durable cleanup retries", async ({
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
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("朗读方式").selectOption("ai");
  await page
    .getByRole("button", { name: "小米 MiMo 配置", exact: true })
    .click();
  await page.getByLabel("API Key", { exact: true }).fill("fake-speech-key");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
  await page
    .getByRole("button", { name: "生成 / 继续整课音频", exact: true })
    .click();
  await adult(page);
  await expect(
    page.getByText("整课音频已保存为课程资源，可以反复离线学习。"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "设为当前孩子的学习课程", exact: true })
    .click();
  await adult(page);
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await page.getByRole("button", { name: "继续读懂故事", exact: true }).click();
  await page.locator(".choice-option").filter({ hasText: "老师" }).click();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "做到了，继续保持！" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保存进度并切换", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  const snapshot = await state(page),
    id = snapshot.courses[0].id;
  const resourceKey = id + ":" + snapshot.courses[0].package.course.version;
  const resources = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("speech-native-fixture")!).resources,
  );
  expect(resources[resourceKey]).toBeDefined();
  await page.evaluate(
    ({ id }) => {
      const wrapper = JSON.parse(
        sessionStorage.getItem("speech-native-fixture")!,
      );
      const data = JSON.parse(wrapper.payload);
      data.learners.push({
        id: "second-child",
        nickname: "另一个孩子",
        createdAt: new Date().toISOString(),
      });
      data.learningCourseIds["second-child"] = id;
      data.confirmedCourses.push({
        learnerId: "second-child",
        courseId: id,
        version: data.courses[0].package.course.version,
      });
      wrapper.payload = JSON.stringify(data);
      sessionStorage.setItem("speech-native-fixture", JSON.stringify(wrapper));
    },
    { id },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family");
  await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await expect(page.locator(".course-library-page")).toBeVisible();
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
  const after = await state(page);
  expect(after.courses[0].deletedAt).toBeTruthy();
  expect(after.learners).toHaveLength(2);
  expect(after.learningCourseIds).toEqual({});
  expect(after.events).toEqual(snapshot.events);
  expect(after.runs).toEqual(snapshot.runs);
  expect(after.pendingCourseDeletions).toHaveLength(0);
  expect(
    await page.evaluate(() => (window as any).__deletedResources),
  ).toBeUndefined();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("speech-native-fixture")!).resources,
    ),
  ).toEqual(resources);
  await page.reload();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await page.getByRole("button", { name: "恢复课程", exact: true }).click();
  expect((await state(page)).courses[0].deletedAt).toBeUndefined();
  expect((await state(page)).learningCourseIds).toEqual({});
  await page.getByRole("button", { name: "课程列表", exact: true }).click();
  await openCourse(page, "My Family");
  await expect(page.locator(".course-audio-panel")).toContainText("已就绪");
  await page
    .getByRole("button", { name: "设为当前孩子的学习课程", exact: true })
    .click();
  await adult(page);
  await page.getByRole("button", { name: "报告", exact: true }).click();
  await expect(page.locator(".parent-page")).toContainText("老师");
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await expect(page.locator(".hero-copy")).toContainText("My Family");
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await openCourse(page, "My Family");
  await page.getByRole("button", { name: "删除课程", exact: true }).click();
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await expect(page.locator(".deleted-course-list")).toContainText("My Family");
  await page.evaluate(() => {
    (window as any).__saveFailure = true;
  });
  await page.getByRole("button", { name: "彻底删除", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "保存未完成" }),
  ).toBeVisible();
  expect((await state(page)).courses[0].id).toBe(id);
  expect((await state(page)).events).toEqual(snapshot.events);
  expect(
    await page.evaluate(() => (window as any).__deletedResources),
  ).toBeUndefined();
  await page.evaluate(() => {
    (window as any).__saveFailure = false;
    (window as any).__cleanupFailure = true;
    sessionStorage.setItem("cleanup-failure", "true");
  });
  await page.getByRole("button", { name: "彻底删除", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "资源清理未完成" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^已删除/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "恢复课程", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "撤销删除", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".course-list-entry")).toHaveCount(1);
  let purged = await state(page);
  expect(purged.courses).toHaveLength(0);
  expect(purged.events).toHaveLength(0);
  expect(purged.runs).toHaveLength(0);
  expect(purged.confirmedCourses).toHaveLength(0);
  expect(purged.learners).toHaveLength(2);
  expect(purged.pendingCourseDeletions).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "资源清理未完成" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到家长空间", exact: true })
    .click();
  await page.getByRole("button", { name: "课程", exact: true }).click();
  await expect(page.getByRole("button", { name: /^已删除/ })).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__cleanupFailure = false;
    sessionStorage.removeItem("cleanup-failure");
  });
  await page
    .getByRole("button", { name: "重试课程资源清理", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).pendingCourseDeletions.length)
    .toBe(0);
  expect(
    await page.evaluate(
      () => (window as any).__deletedResources.course.courseId,
    ),
  ).toBe(id);
  expect(
    await page.evaluate(
      ({ resourceKey }) =>
        JSON.parse(sessionStorage.getItem("speech-native-fixture")!).resources[
          resourceKey
        ],
      { resourceKey },
    ),
  ).toBeUndefined();
});

test("course list swipes support direct deletion, short-swipe actions, vertical scrolling and immediate undo", async ({
  page,
}) => {
  await boot(page);
  await newDraft(page);
  await page.getByLabel("课程标题", { exact: true }).fill("Swipe draft");
  await page.getByRole("button", { name: "返回课程列表", exact: true }).click();
  async function swipe(title: string, dx: number, dy = 0) {
    const row = page.locator(".swipe-course-row").filter({ hasText: title });
    const bounds = (await row.boundingBox())!;
    const x = bounds.x + bounds.width - 18,
      y = bounds.y + 26;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  }
  await swipe("Swipe draft", -5, 80);
  await expect(page.locator(".course-library-page")).toBeVisible();
  expect((await state(page)).courses[0].deletedAt).toBeUndefined();
  await swipe("Swipe draft", -180);
  await expect(page.locator(".course-list-entry")).toHaveCount(1);
  await expect(page.getByLabel("7加5的答案")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await state(page)).courses[0].deletedAt).toBeTruthy();
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.locator(".course-list-entry")).toHaveCount(2);
  await swipe("Swipe draft", -70);
  const action = page.getByRole("button", {
    name: "删除课程：Swipe draft",
    exact: true,
  });
  await expect(action).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/course-swipe-delete-mobile.png",
    fullPage: true,
  });
  await action.click();
  await expect(page.locator(".course-list-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "已删除（1）", exact: true }).click();
  await page.screenshot({
    path: "artifacts/screenshots/course-deleted-mobile.png",
    fullPage: true,
  });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await back(page);
  await expect(page.locator(".course-list-entry")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "删除课程：一起加入运动队", exact: true }),
  ).toHaveCount(0);
});

test("system back from student settings restores the previous screen and only leaves the app at the home root", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "切换到学习空间", exact: true })
    .click();
  await page.getByRole("button", { name: "成长", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await back(page);
  await expect(
    page.getByRole("heading", { name: "看见自己的成长", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => !!(window as any).__appExited)).toBe(false);
  await back(page);
  await expect(page.locator(".hero-copy")).toBeVisible();
  await back(page);
  await expect
    .poll(async () => page.evaluate(() => !!(window as any).__appExited))
    .toBe(true);
});
