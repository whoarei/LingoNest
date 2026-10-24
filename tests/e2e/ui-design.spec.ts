import { expect, test, type Page } from "@playwright/test";
import { navigate, parentSpace, passageSnapshot, seedApplication } from "./fixtures/application";

const capture = async (page: Page, name: string) => {
  if (!process.env.UI_REVIEW_CAPTURE) return;
  const path = `artifacts/ui-review-${process.env.UI_REVIEW_CAPTURE}/${name}`;
  await page.screenshot({ path: `${path}.png`, fullPage: true });
  await page.screenshot({ path: `${path}-viewport.png` });
};

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const nav = await page.locator(".application-navigation").boundingBox();
  expect(nav).not.toBeNull();
  expect(Math.abs(nav!.y + nav!.height - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
}

for (const mode of ["seven-step", "passage-path"]) {
  test(`${mode}: shared pages and learning layouts`, async ({ page }) => {
    await seedApplication(page, { mode, starter: mode === "passage-path" });
    await page.goto("/");
    await expect(page.locator(".application-context")).toBeVisible();
    await expect(page.locator(mode === "seven-step" ? ".home-page" : ".passage-hero")).toBeVisible();
    await fitsViewport(page);
    await capture(page, `${mode}-home-mobile`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await capture(page, `${mode}-home-desktop`);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await navigate(page, "课程"); await fitsViewport(page);
      if (width === 390) await capture(page, `${mode}-courses`);
      await navigate(page, "记录"); await fitsViewport(page);
      if (width === 390) await capture(page, `${mode}-records`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate(page, "学习"); await parentSpace(page);
    await capture(page, `${mode}-parent`);
    await navigate(page, "设置");
    const modes = page.getByRole("radiogroup", { name: "全局课程模式" });
    const selected = modes.locator('[aria-checked="true"]');
    const other = modes.locator('[aria-checked="false"]');
    expect(await selected.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await other.evaluate(el => getComputedStyle(el).backgroundColor));
    const save = page.getByRole("button", { name: "保存配置", exact: true });
    const preview = page.getByRole("button", { name: "保存并试听", exact: true });
    expect(await save.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await preview.evaluate(el => getComputedStyle(el).backgroundColor));
    const returnLink = page.locator(".frame-page-heading .frame-link");
    await expect(returnLink).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "1.25×", exact: true }).click();
    await expect(page.getByRole("button", { name: "1.25×", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "0.9×", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => scrollTo(0, 0));
    await capture(page, `${mode}-settings`);
    await page.setViewportSize({ width: 320, height: 568 });
    await capture(page, `${mode}-settings-narrow`);
    await fitsViewport(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await capture(page, `${mode}-settings-desktop`);
  });
}

test("settings modes support keyboard selection and group links reach the right form", async ({ page }) => {
  await seedApplication(page); await page.goto("/"); await parentSpace(page); await navigate(page, "设置");
  const seven = page.getByRole("radio", { name: /七步/ });
  const passage = page.getByRole("radio", { name: /课文闯关/ });
  await seven.focus(); await page.keyboard.press("End");
  await expect(passage).toHaveAttribute("aria-checked", "true"); await expect(passage).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(seven).toHaveAttribute("aria-checked", "true"); await expect(seven).toBeFocused();
  await page.getByRole("navigation", { name: "设置分组" }).getByRole("link", { name: "语音与朗读" }).click();
  const title = await page.getByRole("heading", { name: "语音模型与朗读配置" }).boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(0); expect(title!.y).toBeLessThan(100);
  await page.getByRole("button", { name: "保存并试听", exact: true }).scrollIntoViewIfNeeded();
  const save = await page.getByRole("button", { name: "保存配置", exact: true }).boundingBox();
  const preview = await page.getByRole("button", { name: "保存并试听", exact: true }).boundingBox();
  expect(save!.height).toBeGreaterThanOrEqual(44); expect(preview!.height).toBeGreaterThanOrEqual(44);
  if (Math.abs(save!.y - preview!.y) < 1) expect(preview!.x - save!.x - save!.width).toBeGreaterThanOrEqual(8);
  await capture(page, "settings-speech-actions");
});

test("passage practice distinguishes selection and feedback and keeps actions on screen", async ({ page }) => {
  await seedApplication(page, { mode: "passage-path", starter: true }); await page.goto("/");
  await page.getByRole("button", { name: "开始学习", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "本轮练习进度" })).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bar = await page.locator(".passage-submit-actions").boundingBox();
    expect(Math.abs(bar!.y + bar!.height - 640)).toBeLessThanOrEqual(1);
  }
  const state = await passageSnapshot(page), session = state.sessions.at(-1)!, item = session.queue[session.index]!;
  const question = state.packages.find(pkg => pkg.revision === item.revision)!.questions.find(question => question.id === item.questionId)!;
  if (!("options" in question)) throw Error("Expected a choice question.");
  const wrong = question.options.find(option => option.id !== question.correctOptionId)!;
  await page.locator(".passage-choices").getByRole("button", { name: wrong.text, exact: true }).click();
  await expect(page.locator(".passage-option-check")).toBeVisible();
  await capture(page, "passage-practice-selection");
  await page.getByRole("button", { name: "检查答案", exact: true }).click();
  await expect(page.locator(".passage-feedback.needs-practice")).toContainText("一起看一看");
  await expect(page.locator(".passage-feedback.is-correct")).toHaveCount(0);
  await expect(page.locator(".passage-feedback").getByRole("button", { name: "继续", exact: true })).toBeFocused();
  await capture(page, "passage-practice-feedback");
});
