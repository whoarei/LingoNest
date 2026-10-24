import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
const legacy = JSON.parse(readFileSync(new URL("../../fixtures/seven-step-legacy.json", import.meta.url), "utf8"));
import { approve } from "../../fixtures/passage-path";
import { makePassageAudioManifest } from "../../../packages/learning-modes/passage-path/authoring";
import { starterRecord } from "../../../packages/learning-modes/seven-step/authoring";
import type { PassageState } from "../../../packages/learning-modes/passage-path/model";

export async function seedApplication(page: Page, options: { mode?: string; passage?: PassageState | null; starter?: boolean; empty?: boolean; legacyApis?: boolean } = {}) {
  if (options.legacyApis) await page.addInitScript(() => {
    Object.defineProperty(Array.prototype, "at", { value: undefined, writable: true, configurable: true });
    Object.defineProperty(Promise, "allSettled", { value: undefined, writable: true, configurable: true });
  });
  for (const [target, fixture] of [["native", "speech-native"], ["platform/content", "course-content"]])
    await page.route(`**/src/${target}.ts`, route => route.fulfill({ contentType: "application/javascript", body: readFileSync(new URL(`./${fixture}.js`, import.meta.url), "utf8") }));
  const passage = options.passage === undefined ? approve() : options.passage;
  const manifests = passage?.publications.map(publication => makePassageAudioManifest(passage.packages.find(pkg => pkg.courseId === publication.courseId && pkg.revision === publication.revision)!)) ?? [];
  const snapshot = options.empty ? null : { ...legacy.snapshot, learningCourseIds: options.starter ? { ...legacy.snapshot.learningCourseIds, "legacy-a": starterRecord.id } : legacy.snapshot.learningCourseIds };
  await page.addInitScript(({ snapshot, mode, passage, manifests }) => {
    if (sessionStorage.getItem("speech-native-fixture")) return;
    const cfg = { mode: "ai", protocol: "openai-speech", baseUrl: "https://speech.example.com/v1", model: "test-tts", voice: "alloy", speed: .9, instructions: "", hasKey: true };
    const variant = JSON.stringify([cfg.protocol, cfg.baseUrl, cfg.model, cfg.voice, cfg.instructions]);
    sessionStorage.setItem("speech-native-fixture", JSON.stringify({ revision: snapshot ? 7 : 0, payload: snapshot ? JSON.stringify(snapshot) : null, cfg, cache: [], variants: {}, active: "", draft: "", requests: 0, plays: 0,
      resources: Object.fromEntries(manifests.map(manifest => [manifest.courseId + ":" + manifest.courseVersion, { total: manifest.assets.length, variants: { [variant]: { files: manifest.assets.map(item => item.id), voice: cfg.voice, model: cfg.model } }, active: variant, draft: "" }])) }));
    sessionStorage.setItem("native-document:lingonest.mode-settings.v1", JSON.stringify({ revision: 1, payload: JSON.stringify({ formatVersion: 1, activeModeId: mode }) }));
    if (passage) sessionStorage.setItem("native-document:lingonest.passage-path.v1", JSON.stringify({ revision: 1, payload: JSON.stringify(passage) }));
  }, { snapshot, mode: options.mode ?? "seven-step", passage, manifests });
}
export async function adult(page: Page) {
  if (!(await page.getByLabel("7加5的答案").isVisible())) return;
  await expect(page.getByLabel("7加5的答案")).toBeVisible();
  await page.getByLabel("7加5的答案").fill("12");
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
}
export async function parentSpace(page: Page) {
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("button", { name: "家长空间", exact: true }).click();
  await expect(page.getByLabel("7加5的答案")).toBeVisible(); await adult(page);
  await expect(page.getByRole("navigation", { name: "家长导航" })).toBeVisible();
}
export async function navigate(page: Page, name: "概况" | "学习" | "课程" | "记录" | "设置") {
  await page.locator(".application-navigation").getByRole("button", { name, exact: true }).click();
}
export async function switchMode(page: Page, mode: "七步" | "课文闯关") {
  await navigate(page, "设置");
  await page.getByRole("radio", { name: new RegExp(mode) }).click(); await adult(page);
}
export async function snapshot(page: Page) { return page.evaluate(() => JSON.parse(JSON.parse(sessionStorage.getItem("speech-native-fixture")!).payload)); }
export async function passageSnapshot(page: Page): Promise<PassageState> { return page.evaluate(() => JSON.parse(JSON.parse(sessionStorage.getItem("native-document:lingonest.passage-path.v1")!).payload)); }
export async function manageCourse(page: Page, title: string, mode: "七步" | "课文闯关") {
  await navigate(page, "课程");
  await page.locator(".frame-course-entry").filter({ hasText: title }).click();
  await page.locator(".frame-list-row").filter({ hasText: mode }).getByRole("button", { name: "准备／查看内容", exact: true }).click();
}
