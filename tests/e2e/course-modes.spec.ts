import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type legacyFixture from "../fixtures/seven-step-legacy.json";
import { starterRecord } from "../../packages/learning-modes/seven-step/authoring";

const legacy: typeof legacyFixture = JSON.parse(readFileSync(new URL("../fixtures/seven-step-legacy.json", import.meta.url), "utf8"));
const settingsKey = "lingonest.mode-settings.v1";
const raw = JSON.stringify({ revision: 7, payload: JSON.stringify(legacy.snapshot) });
const courses = [
  { id: legacy.snapshot.courses[0]!.id, title: legacy.snapshot.courses[0]!.title },
  { id: starterRecord.id, title: starterRecord.title },
];
async function seed(page: Page, activeModeId?: string) {
  await page.addInitScript(({ oldKey, raw, settingsKey, activeModeId, courses }) => {
    if (!localStorage.getItem(oldKey)) localStorage.setItem(oldKey, raw);
    if (activeModeId && !localStorage.getItem(settingsKey)) localStorage.setItem(settingsKey, JSON.stringify({ revision: 1, payload: JSON.stringify({ formatVersion: 1, activeModeId }) }));
    (window as any).__fixtureCourses = courses;
  }, { oldKey: legacy.storageKey, raw, settingsKey, activeModeId, courses });
}
async function fixtureRegistry(page: Page) {
  await page.route("**/src/modes/registry.ts", route => route.fulfill({ contentType: "application/javascript", body: `
    import { createTeachingModeRegistry } from '/packages/learning-modes/contracts.ts';
    import { sevenStepRegistration } from '/src/modes/seven-step/register.ts';
    import { testAdaptiveRegistration } from '/tests/e2e/fixtures/adaptive-mode.ts';
    export const teachingModes = createTeachingModeRegistry([sevenStepRegistration, testAdaptiveRegistration], 'seven-step');
  ` }));
}
async function openModes(page: Page) {
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
}
async function confirm(page: Page) {
  await page.getByLabel("7加5的答案").fill("12");
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
}
test("production exposes only seven-step and retains one device-wide setting across profiles and reloads", async ({ page }) => {
  await seed(page); await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "全局课程模式" })).toBeVisible();
  await page.getByRole("button", { name: "返回学习空间", exact: true }).click();
  await openModes(page);
  await expect(page.getByRole("heading", { name: "小窝设置", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "家长导航" }).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("navigation", { name: "家长导航" }).getByRole("button", { name: "模式", exact: true })).toHaveCount(0);
  const radios = page.getByRole("radiogroup", { name: "全局课程模式" }).getByRole("radio");
  await expect(radios).toHaveCount(1);
  await expect(radios.first()).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("目前只有", { exact: false })).toBeVisible();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const navigation = page.getByRole("navigation", { name: "家长导航" });
    const buttons = await navigation.getByRole("button").all();
    for (const button of buttons) {
      const bounds = await button.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await expect(page.getByRole("radio").first()).toBeInViewport();
    await page.screenshot({ path: `artifacts/global-course-mode-${width}.png`, fullPage: true });
  }
  const settings = await page.evaluate(key => localStorage.getItem(key), settingsKey);
  await radios.first().click();
  expect(await page.evaluate(key => localStorage.getItem(key), settingsKey)).toBe(settings);
  expect(await page.evaluate(key => localStorage.getItem(key), legacy.storageKey)).toBe(raw);
  await page.locator(".settings-page").getByRole("button", { name: "管理孩子档案", exact: true }).click();
  await page.locator(".learner-option").filter({ hasText: legacy.snapshot.learners[1]!.nickname }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), settingsKey)).toBe(settings);
  const state = await page.evaluate(key => JSON.parse(JSON.parse(localStorage.getItem(key)!).payload), legacy.storageKey);
  expect(state.courses).toEqual(legacy.snapshot.courses);
  expect(state.events).toEqual(legacy.snapshot.events);
  expect(state.runs).toEqual(legacy.snapshot.runs);
  await page.reload(); await openModes(page);
  await expect(radios.first()).toHaveAttribute("aria-checked", "true");
});
test("unknown saved mode requires parent confirmation and never silently loads seven-step", async ({ page }) => {
  await seed(page, "removed-mode"); await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("尚未安装");
  await expect(page.locator(".seven-step-mode")).toHaveCount(0);
  await page.getByRole("radio", { name: /七步/ }).click();
  await expect(page.locator(".seven-step-mode")).toHaveCount(0);
  await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), legacy.storageKey)).toBe(raw);
});
test("switches globally, blocks every unprepared course, requires generation and review, and restores seven-step progress", async ({ page }) => {
  await fixtureRegistry(page); await seed(page); await page.goto("/"); await openModes(page);
  await page.getByRole("radio", { name: /测试自适应模式/ }).click();
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  await confirm(page);
  await expect(page.locator(".test-adaptive-experience")).toBeVisible();
  await expect(page.locator(".seven-step-mode")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "本课尚未生成当前模式内容" })).toBeVisible();
  await page.getByRole("navigation", { name: "测试课程选择" }).getByRole("button", { name: courses[1]!.title, exact: true }).click();
  await expect(page.getByRole("heading", { name: "本课尚未生成当前模式内容" })).toBeVisible();
  await page.getByRole("button", { name: "请家长生成并审核", exact: true }).click();
  await page.getByRole("button", { name: "模拟生成内容" }).click();
  await expect(page.getByRole("heading", { name: "当前模式内容待审核" })).toBeVisible();
  await expect(page.getByText("本课已审核，可以开始测试学习。")).toHaveCount(0);
  await page.getByRole("button", { name: "审核并开放测试内容" }).click();
  await expect(page.getByText("本课已审核，可以开始测试学习。")).toBeVisible();
  await page.getByRole("navigation", { name: "测试课程选择" }).getByRole("button", { name: courses[0]!.title, exact: true }).click();
  await expect(page.getByRole("heading", { name: "本课尚未生成当前模式内容" })).toBeVisible();
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), legacy.storageKey)).toBe(raw);
  await page.reload();
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), legacy.storageKey)).toBe(raw);
  await openModes(page); await page.getByRole("radio", { name: /测试自适应模式/ }).click(); await confirm(page);
  await page.getByRole("navigation", { name: "测试课程选择" }).getByRole("button", { name: courses[1]!.title, exact: true }).click();
  await expect(page.getByText("本课已审核，可以开始测试学习。")).toBeVisible();
});
test("a failed global setting save keeps the outgoing experience and old snapshots", async ({ page }) => {
  await fixtureRegistry(page); await seed(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if ((window as any).__failModeSave && key === "lingonest.mode-settings.v1") throw Error("模拟模式设置保存失败");
      return original.call(this, key, value);
    };
  });
  await page.goto("/"); await openModes(page);
  await page.evaluate(() => { (window as any).__failModeSave = true; });
  await page.getByRole("radio", { name: /测试自适应模式/ }).click(); await confirm(page);
  await expect(page.getByRole("alert")).toContainText("模拟模式设置保存失败");
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(key => localStorage.getItem(key), legacy.storageKey)).toBe(raw);
});

test("settings retain the editor and require its draft to save before switching modes; retry and round-trip preserve legacy progress", async ({ page }) => {
  await fixtureRegistry(page);
  await page.route("**/src/native.ts", route => route.fulfill({ contentType: "application/javascript", body: readFileSync(new URL("./fixtures/speech-native.js", import.meta.url), "utf8").replace("saveState: async (input) => {", `saveState: async (input) => {
    if (window.__holdLearningSave) await new Promise(resolve => { window.__releaseLearningSave = resolve; });
  `) }));
  await page.addInitScript(({ snapshot, courses }) => {
    if (!sessionStorage.getItem("speech-native-fixture")) sessionStorage.setItem("speech-native-fixture", JSON.stringify({ revision: 7, payload: JSON.stringify(snapshot), cfg: { mode: "device", protocol: "openai-speech", speed: .9, voice: "alloy", hasKey: false }, cache: [], variants: {}, active: "", draft: "", requests: 0, plays: 0 }));
    (window as any).__fixtureCourses = courses;
  }, { snapshot: legacy.snapshot, courses });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "家长导航" });
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await navigation.getByRole("button", { name: "课程", exact: true }).click();
  await page.getByRole("button", { name: "新建课程", exact: true }).click(); await confirm(page);
  const title = page.getByLabel("课程标题", { exact: true });
  await title.fill("已保存草稿");
  const readState = () => page.evaluate(() => JSON.parse(JSON.parse(sessionStorage.getItem("speech-native-fixture")!).payload));
  await expect.poll(async () => (await readState()).courses[1]?.title).toBe("已保存草稿");
  const settings = await page.evaluate(() => sessionStorage.getItem("native-document:lingonest.mode-settings.v1"));
  await page.evaluate(() => { (window as any).__saveFailure = true; });
  await title.fill("切换前的未保存修改");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "全局课程模式" })).toBeVisible();
  await expect(page.locator(".busy-indicator")).toHaveCount(0);
  await page.getByRole("radio", { name: /测试自适应模式/ }).click(); await confirm(page);
  await expect(page.getByRole("alert").filter({ hasText: "保存未完成" }).first()).toBeVisible();
  await expect(page.locator(".test-adaptive-experience")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /七步/ })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => sessionStorage.getItem("native-document:lingonest.mode-settings.v1"))).toBe(settings);
  await page.getByRole("button", { name: "返回家长空间", exact: true }).click();
  await expect(title).toHaveValue("切换前的未保存修改");
  // Internal tab requests and leaving parent space must share the save guard.
  await page.locator(".parent-child-button").click();
  await expect(title).toHaveValue("切换前的未保存修改");
  await page.getByRole("button", { name: "切换到学习空间", exact: true }).click();
  await expect(title).toHaveValue("切换前的未保存修改");
  expect(await page.evaluate(() => sessionStorage.getItem("native-document:lingonest.mode-settings.v1"))).toBe(settings);
  expect((await readState()).courses[1].title).toBe("已保存草稿");
  await page.evaluate(() => { (window as any).__saveFailure = false; (window as any).__holdLearningSave = true; });
  await navigation.getByRole("button", { name: "报告", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseLearningSave)).toBe("function");
  await expect(title).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "全局课程模式" })).toHaveCount(0);
  await navigation.getByRole("button", { name: "概况", exact: true }).click();
  await expect(title).toBeVisible();
  await title.fill("保存等待期间的最新修改");
  await page.evaluate(() => { (window as any).__holdLearningSave = false; (window as any).__releaseLearningSave(); });
  await expect(page.getByRole("heading", { name: "学习报告", exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "课程", exact: true }).click();
  await page.locator(".course-list button").filter({ hasText: "保存等待期间的最新修改" }).click();
  await expect(title).toHaveValue("保存等待期间的最新修改");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator(".busy-indicator")).toHaveCount(0);
  const beforeSwitch = await readState();
  expect(beforeSwitch.courses[1].title).toBe("保存等待期间的最新修改");
  await page.getByRole("radio", { name: /测试自适应模式/ }).click();
  await expect(page.locator(".test-adaptive-experience")).toHaveCount(0);
  await confirm(page);
  await expect(page.locator(".test-adaptive-experience")).toBeVisible();
  const saved = await readState();
  // A retained editor may refresh its save timestamp while preparing the switch.
  expect(saved.courses[1]).toEqual({ ...beforeSwitch.courses[1], updatedAt: saved.courses[1].updatedAt });
  expect({ ...saved, courses: beforeSwitch.courses }).toEqual(beforeSwitch);
  await page.getByRole("button", { name: "家长空间", exact: true }).click();
  await page.getByRole("radio", { name: /七步/ }).click(); await confirm(page);
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  expect(await readState()).toEqual(saved);
  await page.reload();
  await expect(page.locator(".seven-step-mode")).toBeVisible();
  expect(await readState()).toEqual(saved);
  const final = await readState();
  expect(final.courses[0]).toEqual(legacy.snapshot.courses[0]);
  expect(final.events).toEqual(legacy.snapshot.events);
  expect(final.runs).toEqual(legacy.snapshot.runs);
  await page.getByRole("button", { name: "切换到家长空间", exact: true }).click();
  await navigation.getByRole("button", { name: "课程", exact: true }).click();
  await page.locator(".course-list button").filter({ hasText: "保存等待期间的最新修改" }).click();
  await expect(title).toHaveValue("保存等待期间的最新修改");
});
