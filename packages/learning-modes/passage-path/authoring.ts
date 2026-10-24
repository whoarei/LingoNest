import type { CourseAudioManifest, SourceImage } from "../contracts";
import type { PassageSource, PassageDraft, PassagePackage, PassageRules, PassageQuestion } from "./model";
import { normalizeAnswer, questionFingerprint } from "./grading";
import { array, copy, id, ids, record, requireValid, text, time, uniqueRecords } from "./validation";

export const basicPassageRules: Readonly<PassageRules> = Object.freeze({
  version: "2", questionCount: 6, minQuestionCount: 4, maxNewChunks: 2,
  dueCount: 1, weakCount: 1, maxCrossCourse: 1, maxRepairs: 2,
});
export const defaultPassageRules: Readonly<PassageRules> = Object.freeze({ ...basicPassageRules, version: "3" });
export function createPassageSource(input: { courseId: string; revision: string; title: string; sourceText: string; images?: SourceImage[] }): PassageSource {
  requireValid(id(input.courseId) && id(input.revision) && text(input.title, 200) && text(input.sourceText, 6000), "教材身份或原文无效。");
  const lines = input.sourceText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  requireValid(lines.length > 0 && lines.length <= 60, "课文需要 1～60 个段落或话轮。");
  const source = { courseId: input.courseId, revision: input.revision, title: input.title, ...(input.images ? { images: copy(input.images) } : {}),
    turns: lines.map((line, index) => {
      const role = line.match(/^([A-Za-z][A-Za-z .'-]{0,35}):\s+(.+)$/);
      return { id: `turn-${index + 1}`, speaker: role?.[1] ?? "课文", text: role?.[2] ?? line };
    }) };
  validateSource(source);
  return source;
}
export function validateSource(value: unknown): asserts value is PassageSource {
  requireValid(record(value) && id(value.courseId) && id(value.revision) && text(value.title, 200), "材料快照无效。");
  uniqueRecords(value.turns, 60);
  requireValid(value.turns.length > 0 && value.turns.every(turn => text(turn.speaker, 100) && text(turn.text, 2000) && /[A-Za-z]/.test(turn.text)), "材料话轮无效。");
  requireValid(value.turns.reduce((size, turn) => size + String(turn.text).length, 0) <= 6000, "材料过长。");
  requireValid(value.images === undefined || array(value.images, 12) && value.images.every(image => record(image) &&
    typeof image.path === "string" && /^(?:course-images\/[a-f0-9-]{36}\.jpg|\/source\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp))$/.test(image.path) &&
    [0, 90, 180, 270].includes(Number(image.rotation)) && typeof image.rotation === "number"), "材料图片引用无效。");
}
export function validateRules(value: unknown): asserts value is PassageRules {
  requireValid(record(value) && typeof value.version === "string" && ["1", "2", "3"].includes(value.version), "不支持的编排规则版本。");
  const integer = (key: string, min: number, max: number) => Number.isInteger(value[key]) && Number(value[key]) >= min && Number(value[key]) <= max;
  const minimum = value.version === "1" ? 6 : 4;
  requireValid(integer("questionCount", minimum, value.version === "1" ? 10 : 6) && integer("minQuestionCount", minimum, Number(value.questionCount)) &&
    integer("maxNewChunks", 1, 3) && integer("dueCount", 0, 3) && integer("weakCount", 0, 2) &&
    integer("maxCrossCourse", 0, 2) && integer("maxRepairs", 0, 2) &&
    Number(value.dueCount) + Number(value.weakCount) <= Number(value.questionCount) - 2, "编排预算无效。");
}
export function validateDraft(value: unknown, source: PassageSource, rules: PassageRules = defaultPassageRules): asserts value is PassageDraft {
  validateSource(source); validateRules(rules);
  requireValid(record(value), "生成草稿格式无效。");
  uniqueRecords(value.chunks, 80); uniqueRecords(value.goals, 160);
  uniqueRecords(value.levels, 80); uniqueRecords(value.questions, 2000);
  const draft = value as unknown as PassageDraft;
  requireValid(draft.chunks.length && draft.goals.length && draft.levels.length, "知识块、目标和关卡不能为空。");
  const sources = new Set(source.turns.map(turn => turn.id));
  const validSources = (refs: unknown) => ids(refs, 60) && refs.length > 0 && refs.every(ref => sources.has(ref));
  for (const chunk of draft.chunks)
    requireValid(text(chunk.title, 200) && text(chunk.expression, 500) && text(chunk.meaning, 1000) && validSources(chunk.sourceTurnIds), "知识块缺少有效内容或来源。");
  for (const goal of draft.goals)
    requireValid(draft.chunks.some(chunk => chunk.id === goal.chunkId) && text(goal.title, 200) &&
      ["meaning", "listening", "expression"].includes(goal.skill) && typeof goal.requiresRecall === "boolean", "学习目标无效。");
  requireValid(draft.chunks.every(chunk => draft.goals.some(goal => goal.chunkId === chunk.id)), "存在未使用的知识块。");
  for (const question of draft.questions) {
    const goal = draft.goals.find(item => item.id === question.goalId);
    requireValid(goal && text(question.prompt) && text(question.explanation) && validSources(question.sourceTurnIds) &&
      (question.audioText === null || text(question.audioText, 1000)), "题目内容、目标或来源无效。");
    const chunk = draft.chunks.find(item => item.id === goal.chunkId)!;
    requireValid(question.sourceTurnIds.some(ref => chunk.sourceTurnIds.includes(ref)), "题目与知识块来源不相交。");
    requireValid(goal.skill !== "listening" || text(question.audioText, 1000), "听辨目标缺少音频。");
    requireValid(question.context === undefined || record(question.context) && question.context.kind === "transfer" && text(question.context.text, 500), "情境迁移缺少明确的新情境。");
    validateQuestion(question);
  }
  requireValid(new Set(draft.questions.map(questionFingerprint)).size === draft.questions.length, "候选题内容重复，不能仅更换标识凑足题量。");
  const introduced = new Set<string>();
  for (const level of draft.levels) {
    requireValid(text(level.title, 200) && ids(level.newGoalIds, 10) && ids(level.reviewGoalIds, 160) &&
      level.newGoalIds.length + level.reviewGoalIds.length > 0, "关卡内容无效。");
    requireValid(level.newGoalIds.every(goal => !introduced.has(goal) && draft.goals.some(item => item.id === goal)) &&
      level.reviewGoalIds.every(goal => introduced.has(goal)), "关卡引用了未学目标或重复引入目标。");
    const newChunks = new Set(level.newGoalIds.map(goal => draft.goals.find(item => item.id === goal)!.chunkId));
    requireValid(newChunks.size <= rules.maxNewChunks, "单关新增知识块过多。");
    const goals = [...level.newGoalIds, ...level.reviewGoalIds];
    const candidates = draft.questions.filter(question => goals.includes(question.goalId));
    requireValid(candidates.length >= rules.minQuestionCount, "关卡候选题不足，无法形成合法轮次。");
    let minimum = level.reviewGoalIds.length;
    for (const goalId of level.newGoalIds) {
      const goal = draft.goals.find(item => item.id === goalId)!;
      requireValid(candidates.some(question => question.goalId === goalId && question.demand === "recognize"), "新目标缺少理解题。");
      requireValid(!goal.requiresRecall || candidates.some(question => question.goalId === goalId && question.demand === "recall"), "目标承诺独立回想但缺少对应题目。");
      minimum += goal.requiresRecall ? 2 : 1;
    }
    requireValid(level.reviewGoalIds.every(goal => candidates.some(question => question.goalId === goal)), "关卡复习目标缺少题目。");
    requireValid(minimum <= rules.questionCount, "关卡必要覆盖超过题量预算。");
    if (rules.version === "3") validateCurriculumLevel(draft, level, rules);
    level.newGoalIds.forEach(goal => introduced.add(goal));
  }
  requireValid(draft.goals.every(goal => introduced.has(goal.id)), "存在没有引入路径的目标。");
}
function validateQuestion(value: PassageQuestion) {
  if (value.kind === "speak") {
    requireValid(value.demand === "supported" && text(value.sampleAnswer, 500) && value.audioText === value.sampleAnswer &&
      array(value.criteria, 4) && value.criteria.length > 0 && value.criteria.every(item => text(item, 200)), "口语任务缺少示范音频、参考表达或回听要点。");
  } else if (value.kind === "cloze") {
    requireValid(value.demand === "recall" && value.prompt.includes("___") && array(value.answers, 5) && value.answers.length > 0 &&
      value.answers.every(answer => text(answer, 500)) && new Set(value.answers.map(normalizeAnswer)).size === value.answers.length, "填空答案无效或重复。");
  } else if (value.kind === "order") {
    uniqueRecords(value.tokens, 60);
    requireValid(value.demand === "supported" && value.tokens.length >= 2 && value.tokens.every(token => text(token.text, 100)) &&
      ids(value.correctTokenIds, 60) && value.correctTokenIds.length === value.tokens.length &&
      value.correctTokenIds.every(token => value.tokens.some(item => item.id === token)), "组句词块或答案无效。");
  } else {
    requireValid(["choice", "listen-choice", "dialogue-choice"].includes(value.kind), "不支持的题型。");
    uniqueRecords(value.options, 4);
    requireValid(value.demand === "recognize" && value.options.length >= 2 && value.options.every(option => text(option.text, 500)) &&
      new Set(value.options.map(option => normalizeAnswer(option.text))).size === value.options.length &&
      value.options.some(option => option.id === value.correctOptionId) &&
      (value.kind !== "listen-choice" || text(value.audioText, 1000)), "选择题选项、答案或音频无效。");
  }
}
function validateCurriculumLevel(draft: PassageDraft, level: PassageDraft["levels"][number], rules: PassageRules) {
  const goals = [...level.newGoalIds, ...level.reviewGoalIds], bank = draft.questions.filter(question => goals.includes(question.goalId));
  const discovery = bank.filter(question => !question.context && question.kind !== "speak");
  const transfer = bank.filter(question => question.context && question.kind !== "speak");
  const communication = bank.filter(question => question.kind === "listen-choice" || question.kind === "speak");
  requireValid([discovery, transfer, communication].every(items => items.length >= rules.minQuestionCount), "每关的初识、情境、听说短课都需要足量已审核候选题。");
  for (const goalId of level.newGoalIds) {
    const goal = draft.goals.find(goal => goal.id === goalId)!;
    requireValid(discovery.some(question => question.goalId === goalId && question.demand === "recognize") &&
      (!goal.requiresRecall || discovery.some(question => question.goalId === goalId && question.demand === "recall")), "初识短课缺少目标的理解或回想题。");
    requireValid(transfer.some(question => question.goalId === goalId && (goal.requiresRecall ? question.demand === "recall" : true)), "情境短课缺少目标的独立应用题。");
    requireValid(communication.some(question => question.goalId === goalId && question.kind === "listen-choice") &&
      communication.some(question => question.goalId === goalId && question.kind === "speak"), "听说短课必须覆盖每个新目标的听辨和口语任务。");
  }
  requireValid(level.newGoalIds.length * 2 + level.reviewGoalIds.length <= rules.questionCount, "听说短课必要覆盖超过题量预算。");
}
export function parseGeneratedDraft(raw: string, source: PassageSource, rules: PassageRules = defaultPassageRules): PassageDraft {
  requireValid(typeof raw === "string" && raw.length <= 500_000, "生成结果过大。");
  const json = raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw Error("课文闯关：生成结果不是有效 JSON，请保留草稿后重试。"); }
  validateDraft(value, source, rules);
  return copy(value);
}
export function compilePassagePackage(input: {
  source: PassageSource; draft: PassageDraft; modeInstanceId: string; revision: string;
  model: string; generatedAt: string; rules?: PassageRules;
}): PassagePackage {
  const rules = input.rules ?? defaultPassageRules;
  validateDraft(input.draft, input.source, rules);
  requireValid(id(input.modeInstanceId) && id(input.revision) && text(input.model, 200) && time(input.generatedAt), "编译来源或版本无效。");
  const pkg: PassagePackage = copy({ ...input.draft, schemaVersion: 1, modeId: "passage-path", runtimeVersion: "1", gradingVersion: "1",
    courseId: input.source.courseId, modeInstanceId: input.modeInstanceId, revision: input.revision, source: input.source,
    provenance: { model: input.model, generatedAt: input.generatedAt, promptVersion: rules.version === "3" ? "2" : "1", compilerVersion: rules.version === "3" ? "2" : "1" }, rules });
  makePassageAudioManifest(pkg);
  return pkg;
}
export function validatePackage(value: unknown): asserts value is PassagePackage {
  requireValid(record(value) && value.schemaVersion === 1 && value.modeId === "passage-path" && value.runtimeVersion === "1" &&
    value.gradingVersion === "1", "不支持的课程包版本，已有内容保留。");
  validateSource(value.source); validateRules(value.rules);
  requireValid(value.courseId === value.source.courseId && id(value.modeInstanceId) && id(value.revision) &&
    record(value.provenance) && text(value.provenance.model, 200) && time(value.provenance.generatedAt) &&
    typeof value.provenance.promptVersion === "string" && ["1", "2"].includes(value.provenance.promptVersion) &&
    typeof value.provenance.compilerVersion === "string" && ["1", "2"].includes(value.provenance.compilerVersion), "课程包身份或生成来源无效。");
  validateDraft(value, value.source, value.rules);
  makePassageAudioManifest(value as unknown as PassagePackage);
}
export function makePassageAudioManifest(pkg: PassagePackage): CourseAudioManifest {
  const courseVersion = `passage-path.${pkg.modeInstanceId.length}.${pkg.modeInstanceId}.${pkg.revision}`;
  requireValid(courseVersion.length <= 128, "模式实例与包修订组合超出音频标识长度。");
  const seen = new Set<string>();
  const assets: CourseAudioManifest["assets"] = [];
  const add = (raw: string) => {
    const value = raw.trim().normalize("NFC");
    if (seen.has(value)) return;
    seen.add(value); assets.push({ id: `audio-${assets.length + 1}`, text: value });
  };
  pkg.source.turns.forEach(turn => add(turn.text));
  pkg.questions.forEach(question => { if (question.audioText !== null) add(question.audioText); });
  const fieldSize = (value: string) => String(value.length).length + 1 + value.length;
  const manifestSize = "course-audio-v1\n".length + fieldSize(pkg.courseId) + fieldSize(courseVersion) +
    assets.reduce((size, asset) => size + fieldSize(asset.id) + fieldSize(asset.text), 0);
  requireValid(assets.length <= 512 && manifestSize <= 512000, "课程音频清单超出设备容量。");
  return { courseId: pkg.courseId, courseVersion, title: pkg.source.title, assets };
}
export function passageQuestionAudioId(pkg: PassagePackage, questionId: string): string {
  const question = pkg.questions.find(question => question.id === questionId);
  requireValid(question?.audioText, "当前题目没有音频。");
  return makePassageAudioManifest(pkg).assets.find(asset => asset.text === question.audioText!.trim().normalize("NFC"))!.id;
}
export function passageTurnAudioId(pkg: PassagePackage, turnId: string): string {
  const turn = pkg.source.turns.find(turn => turn.id === turnId);
  requireValid(turn, "原文话轮不存在。");
  return makePassageAudioManifest(pkg).assets.find(asset => asset.text === turn.text.trim().normalize("NFC"))!.id;
}
