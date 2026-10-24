import { describe, expect, it } from "vitest";
import { compilePassagePackage, defaultPassageRules, makePassageAudioManifest, passageQuestionAudioId, passageTurnAudioId, parseGeneratedDraft, validateDraft, validatePackage } from "../packages/learning-modes/passage-path/authoring";
import { generatePassageCandidate, buildPassageGenerationPrompt } from "../packages/learning-modes/passage-path/prompts";
import { gradeQuestion } from "../packages/learning-modes/passage-path/grading";
import { fixtureCurriculumDraft, fixtureDraft, fixturePackage, fixtureSource } from "./fixtures/passage-path";

describe("passage-path authoring", () => {
  it("extracts dialogue sources without the seven-step length blocks and compiles deterministically", () => {
    const source = fixtureSource();
    expect(source.turns).toHaveLength(15);
    expect(source.turns[12]).toEqual({ id: "turn-13", speaker: "Xia Yiyi", text: "Yes, it is. Will you join us?" });
    expect(source.turns.every(turn => !("block" in turn))).toBe(true);
    expect(fixturePackage()).toEqual(fixturePackage());
    const draft = fixtureDraft();
    const pkg = fixturePackage(undefined, undefined, draft);
    draft.chunks[0]!.meaning = "mutated";
    expect(pkg.chunks[0]!.meaning).toBe("我喜欢打篮球。");
    expect(() => validatePackage(pkg)).not.toThrow();
  });
  it("runs the generation port against a captured source and validates the entire candidate pool", async () => {
    const source = fixtureSource();
    const originalSource = structuredClone(source);
    const draft = fixtureCurriculumDraft();
    const pending = generatePassageCandidate(source, async prompt => {
      expect(prompt).toBe(buildPassageGenerationPrompt(source));
      source.turns = []; // A late model response must still use its original material.
      return `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``;
    });
    expect(await pending).toEqual({ source: originalSource, draft, rules: defaultPassageRules });
    await expect(generatePassageCandidate(fixtureSource(), async () => '{"chunks":[]}')).rejects.toThrow("列表格式");
    expect(() => parseGeneratedDraft("invalid", fixtureSource())).toThrow("有效 JSON");
  });
  it.each([
    ["unknown source", (draft: ReturnType<typeof fixtureDraft>) => { draft.chunks[0]!.sourceTurnIds = ["missing"]; }],
    ["duplicate ID", (draft: ReturnType<typeof fixtureDraft>) => { draft.questions[1]!.id = draft.questions[0]!.id; }],
    ["cloned content with new ID", (draft: ReturnType<typeof fixtureDraft>) => { draft.questions.push({ ...draft.questions[0]!, id: "cloned-question" }); }],
    ["unknown answer", (draft: ReturnType<typeof fixtureDraft>) => { const q = draft.questions[0]!; if (q.kind === "choice") q.correctOptionId = "missing"; }],
    ["ambiguous options", (draft: ReturnType<typeof fixtureDraft>) => { const q = draft.questions[0]!; if (q.kind === "choice") q.options[1]!.text = q.options[0]!.text; }],
    ["recall without candidates", (draft: ReturnType<typeof fixtureDraft>) => { draft.questions = draft.questions.filter(q => q.kind !== "cloze"); }],
    ["missing audio", (draft: ReturnType<typeof fixtureDraft>) => { draft.questions.find(q => q.kind === "listen-choice")!.audioText = null; }],
    ["future review", (draft: ReturnType<typeof fixtureDraft>) => { draft.levels[0]!.reviewGoalIds = ["goal-invite"]; }],
    ["no introduction", (draft: ReturnType<typeof fixtureDraft>) => { draft.levels.pop(); }],
    ["insufficient bank", (draft: ReturnType<typeof fixtureDraft>) => { draft.questions = draft.questions.filter(q => q.goalId !== "goal-like" || ["question-like-0", "question-like-1"].includes(q.id)); }],
  ] as const)("rejects %s before publishing", (_, mutate) => {
    const draft = fixtureDraft(); mutate(draft);
    expect(() => validateDraft(draft, fixtureSource())).toThrow("课文闯关");
  });
  it("validates coverage budgets and keeps compilation versions explicit", () => {
    const draft = fixtureDraft();
    const rules = { ...defaultPassageRules, questionCount: 3 };
    expect(() => compilePassagePackage({ source: fixtureSource(), draft, modeInstanceId: "instance-1", revision: "p1", model: "test", generatedAt: "2026-10-17T10:00:00.000Z", rules })).toThrow("预算");
    expect(() => validatePackage({ ...fixturePackage(), runtimeVersion: "99" })).toThrow("不支持");
    const old = makePassageAudioManifest(fixturePackage());
    const revised = makePassageAudioManifest(fixturePackage(undefined, "package-2"));
    expect(old.courseId).toBe("starter.unit1.lesson1");
    expect(old.courseVersion).not.toBe(revised.courseVersion);
    expect(old.courseVersion).not.toBe("0.1.0");
    expect(old.assets).toHaveLength(17);
    expect(old.assets.find(asset => asset.id === passageTurnAudioId(fixturePackage(), "turn-13"))!.text).toBe("Yes, it is. Will you join us?");
  });
  it("uses narrow answer matching and validates token/option ownership", () => {
    const cloze = fixtureDraft().questions.find(q => q.kind === "cloze")!;
    expect(gradeQuestion(cloze, { text: "  BASKETBALL  ", selectedIds: [] })).toBe(true);
    expect(gradeQuestion(cloze, { text: "not basketball", selectedIds: [] })).toBe(false);
    const choice = fixtureDraft().questions[0]!;
    expect(() => gradeQuestion(choice, { text: "", selectedIds: ["foreign-option"] })).toThrow("不属于");
    expect(() => gradeQuestion(cloze, { text: "basketball", selectedIds: ["yes"] })).toThrow("不能提交");
  });
  it("deduplicates identical speech for the native manifest and maps each question to its actual asset", () => {
    const draft = fixtureDraft();
    draft.questions[0]!.audioText = `  ${draft.questions[4]!.audioText}  `;
    const pkg = fixturePackage(undefined, undefined, draft);
    const manifest = makePassageAudioManifest(pkg);
    expect(manifest.assets).toHaveLength(17);
    const assetId = passageQuestionAudioId(pkg, draft.questions[4]!.id);
    expect(assetId).toBe(passageQuestionAudioId(pkg, draft.questions[0]!.id));
    expect(manifest.assets.find(asset => asset.id === assetId)!.text).toBe("I like playing basketball.");
    const tooLong = structuredClone(pkg); tooLong.modeInstanceId = "i".repeat(120);
    expect(() => validatePackage(tooLong)).toThrow("音频标识长度");
  });
});
