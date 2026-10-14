import type { Course, DialogueTurn } from "./domain";
import type {
  Exercise,
  CellRef,
  StageId,
} from "../packages/learning-engine/src/model";
import { course as starter, exercises as starterExercises } from "./course";

export interface SourceImage {
  path: string;
  rotation: 0 | 90 | 180 | 270;
}
export interface Vocabulary {
  term: string;
  meaning: string;
  example: string;
  selected: boolean;
  origin: "photo" | "auto" | "manual";
}
export interface CourseRecipe {
  translations: string[];
  comprehension: {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  }[];
  applications: { prompt: string; answers: string[]; explanation: string }[];
}
export interface CoursePackage {
  course: Course;
  exercises: Exercise[];
}
export interface CourseRecord {
  deletedAt?: string;
  id: string;
  title: string;
  subtitle: string;
  sourceText: string;
  images: SourceImage[];
  vocabularyImages: SourceImage[];
  vocabulary: Vocabulary[];
  status: "source" | "vocabulary" | "generation" | "review" | "published";
  updatedAt: string;
  recipe: CourseRecipe | null;
  package: CoursePackage | null;
}
export const starterRecord: CourseRecord = {
  id: starter.id,
  title: starter.title,
  subtitle: starter.subtitle,
  sourceText: starter.turns
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join("\n"),
  images: ["1000075731.jpg", "1000075732.jpg", "1000075733.jpg"].map(
    (path) => ({ path: `/source/${path}`, rotation: 0 }),
  ),
  vocabularyImages: [],
  vocabulary: [],
  status: "published",
  updatedAt: "2026-10-11T00:00:00.000Z",
  recipe: null,
  package: { course: starter, exercises: starterExercises },
};
export const courseStatusLabels = {
  source: "待校对原文",
  vocabulary: "待确认词汇",
  generation: "待生成课程",
  review: "待审核课程",
  published: "可学习",
};
const fail = (message: string): never => {
  throw new Error(message);
};
const text = (
  value: unknown,
  max = 3000,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  (allowEmpty || !!value.trim());
export function newCourse(): CourseRecord {
  return {
    id: `user.${Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("")}`,
    title: "",
    subtitle: "",
    sourceText: "",
    images: [],
    vocabularyImages: [],
    vocabulary: [],
    status: "source",
    updatedAt: new Date().toISOString(),
    recipe: null,
    package: null,
  };
}
export function sourceTurns(source: string): DialogueTurn[] {
  if (!text(source, 6000)) fail("请填写不超过 6000 个字符的课文原文。");
  const paragraphs = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paragraphs.length > 60) fail("一节课最多 60 个段落或话轮，请拆分课程。");
  let block = 0,
    size = 0;
  return paragraphs.map((line, index) => {
    const role = line.match(/^([A-Za-z][A-Za-z .'-]{0,35}):\s+(.+)$/);
    const content = role ? role[2]! : line;
    if (!/[A-Za-z]/.test(content) || content.length > 2000)
      fail("每段需包含英语且不超过 2000 个字符，请按段落拆分。");
    if (size + content.length > 2400) {
      block++;
      size = 0;
    }
    if (block > 2) fail("课文过长，请拆分为较短课程。");
    size += content.length;
    return {
      id: `t${index + 1}`,
      block: (["A", "B", "C"] as const)[block]!,
      speaker: role ? role[1]! : "课文",
      text: content,
      translation: "",
    };
  });
}
export function parseModelJSON(raw: string): unknown {
  if (typeof raw !== "string" || raw.length > 200000)
    fail("生成结果为空或过大，请重新生成。");
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(clean);
  } catch {
    return fail("模型没有返回有效的结构化内容，请重试或调整模型配置。");
  }
}
export function validateVocabulary(
  value: unknown,
  draft = false,
): asserts value is Vocabulary[] {
  if (
    !Array.isArray(value) ||
    value.length > 80 ||
    value.some(
      (item) =>
        !item ||
        !text(item.term, 100, draft) ||
        (item.term.trim() &&
          !/^[A-Za-z][A-Za-z '\-]*[A-Za-z]$|^[A-Za-z]$/.test(item.term)) ||
        !text(item.meaning, 300, true) ||
        !text(item.example, 1000, true) ||
        typeof item.selected !== "boolean" ||
        !["photo", "auto", "manual"].includes(item.origin),
    )
  )
    fail("词汇格式无效，请检查词条、释义和来源；最多 80 条。");
}
export function modelVocabulary(
  raw: string,
  origin: "photo" | "auto",
): Vocabulary[] {
  const result = parseModelJSON(raw) as { vocabulary?: unknown[] };
  if (!result || !Array.isArray(result.vocabulary))
    fail("模型未返回词汇清单。");
  const words = result.vocabulary!.map((item) => {
    const word = item as Record<string, unknown>;
    return {
      term: typeof word?.term === "string" ? word.term.trim() : word?.term,
      meaning: word?.meaning ?? "",
      example: word?.example ?? "",
      selected: true,
      origin,
    };
  });
  validateVocabulary(words);
  return mergeVocabulary([], words);
}
export function mergeVocabulary(
  existing: Vocabulary[],
  added: Vocabulary[],
): Vocabulary[] {
  const result = new Map(
    existing.map((word) => [word.term.trim().toLowerCase(), { ...word }]),
  );
  for (const word of added) {
    const key = word.term.trim().toLowerCase();
    if (!result.has(key)) result.set(key, { ...word, term: word.term.trim() });
  }
  const words = [...result.values()];
  validateVocabulary(words, true);
  return words;
}
export function validateRecipe(
  value: unknown,
  turns: DialogueTurn[],
): asserts value is CourseRecipe {
  const recipe = value as CourseRecipe;
  if (
    !recipe ||
    !Array.isArray(recipe.translations) ||
    recipe.translations.length !== turns.length ||
    recipe.translations.some((item) => !text(item, 2000)) ||
    !Array.isArray(recipe.comprehension) ||
    recipe.comprehension.length < 1 ||
    recipe.comprehension.length > 8 ||
    !Array.isArray(recipe.applications) ||
    recipe.applications.length < 1 ||
    recipe.applications.length > 8
  )
    fail("课程生成结果不完整，需要逐段释义、理解题和应用题。");
  for (const item of recipe.comprehension) {
    if (
      !item ||
      !text(item.question, 1000) ||
      !Array.isArray(item.options) ||
      item.options.length < 2 ||
      item.options.length > 4 ||
      item.options.some((option) => !text(option, 500)) ||
      new Set(item.options.map((option) => option.trim().toLowerCase()))
        .size !== item.options.length ||
      !Number.isInteger(item.answerIndex) ||
      item.answerIndex < 0 ||
      item.answerIndex >= item.options.length ||
      !text(item.explanation, 1000, true)
    )
      fail("理解题的选项或答案无效，请重新生成。");
  }
  for (const item of recipe.applications)
    if (
      !item ||
      !text(item.prompt, 1000) ||
      !Array.isArray(item.answers) ||
      item.answers.length < 1 ||
      item.answers.length > 5 ||
      item.answers.some(
        (answer) => !text(answer, 500) || !/[A-Za-z]/.test(answer),
      ) ||
      !text(item.explanation, 1000, true)
    )
      fail("应用题缺少明确的参考答案，请重新生成。");
}
export function buildCoursePackage(record: CourseRecord): CoursePackage {
  const turns = sourceTurns(record.sourceText);
  validateVocabulary(record.vocabulary);
  const words = record.vocabulary.filter((word) => word.selected);
  if (!words.length || words.some((word) => !word.meaning.trim()))
    fail("请先选择重点词汇并补齐释义。");
  if (
    new Set(words.map((word) => word.term.trim().toLowerCase())).size !==
    words.length
  )
    fail("请合并重复词汇后再确认。");
  validateRecipe(record.recipe, turns);
  const recipe = record.recipe!;
  const course: Course = {
    id: record.id,
    version: "1",
    title: record.title.trim(),
    subtitle: record.subtitle.trim() || "自建课程",
    description: "由已确认的原文和重点词汇生成，按七阶段逐步练习。",
    turns: turns.map((turn, index) => ({
      ...turn,
      translation: recipe.translations[index]!,
    })),
  };
  const exercises: Exercise[] = [];
  const base = (
    id: string,
    stageId: StageId,
    kind: Exercise["kind"],
    knowledge: string,
    ability: CellRef["ability"],
    mode: CellRef["mode"],
  ): Exercise => ({
    id: `${record.id}.${id}`,
    stageId,
    kind,
    familyId: `${record.id}.${id}`,
    target: { knowledgeId: `${record.id}.${knowledge}`, ability, mode },
    title: "",
    prompt: "",
    instruction: "",
    hint: "",
    acceptedAnswers: [],
    threshold: 100,
  });
  recipe.comprehension.forEach((item, index) =>
    exercises.push({
      ...base(
        `s1.${index}`,
        "S1",
        "choice",
        `meaning.${index}`,
        "meaning",
        "recognition",
      ),
      title: "理解课文",
      prompt: item.question,
      instruction: "选择符合原文的一项。",
      hint: item.explanation,
      options: item.options.map((option, i) => ({ id: `o${i}`, text: option })),
      correctOptionIds: [`o${item.answerIndex}`],
    }),
  );
  words.forEach((word, index) =>
    exercises.push({
      ...base(
        `s2.${index}`,
        "S2",
        "spelling",
        `word.${index}`,
        "spelling",
        "written",
      ),
      title: "重点词汇拼写",
      prompt: word.meaning,
      instruction: "写出对应的英语单词或短语。",
      hint: `以 ${word.term.slice(0, 1)} 开头。`,
      acceptedAnswers: [word.term.trim()],
    }),
  );
  const sentences = turns.flatMap((turn) =>
    (turn.text.match(/[^.!?]+(?:[.!?]+|$)/g) || [turn.text])
      .map((value) => ({ text: value.trim(), block: turn.block }))
      .filter((item) => item.text),
  );
  if (sentences.length > 80) fail("句子过多，请拆分课程。");
  const exposure = (block: DialogueTurn["block"]): CellRef[] =>
    sentences.flatMap((item, index) =>
      item.block === block
        ? [
            {
              knowledgeId: `${record.id}.sentence.${index}`,
              ability: "dictation" as const,
              mode: "written" as const,
            },
          ]
        : [],
    );
  sentences.forEach((sentence, index) => {
    const tokens = sentence.text
      .split(/\s+/)
      .map((text, i) => ({ id: `w${i}`, text }));
    if (tokens.length > 1)
      exercises.push({
        ...base(
          `s3.${index}`,
          "S3",
          "order",
          `sentence.${index}`,
          "usage",
          "written",
        ),
        title: "把句子排列完整",
        prompt: "将词块排列成课文中的完整句子。",
        instruction: "按顺序点选词块。",
        hint: `句子以 ${tokens[0]!.text} 开头。`,
        tokens: [...tokens].reverse(),
        correctTokenIds: tokens.map((token) => token.id),
        exposureTargets: [
          ...exposure(sentence.block),
          {
            knowledgeId: `${record.id}.block.${sentence.block}`,
            ability: "recall",
            mode: "oral",
          },
        ],
      });
    exercises.push({
      ...base(
        `s6.${index}`,
        "S6",
        "sentence",
        `sentence.${index}`,
        "dictation",
        "written",
      ),
      title: "听写课文句子",
      prompt: "听示范，独立写出这句话。",
      instruction: "保留完整词句和标点。",
      hint: sentence.text,
      speakText: sentence.text,
      acceptedAnswers: [sentence.text],
    });
  });
  if (!exercises.some((exercise) => exercise.stageId === "S3"))
    fail("课文需包含至少一个由多个单词组成的句子。");
  for (const block of ["A", "B", "C"] as const) {
    const reference = turns
      .filter((turn) => turn.block === block)
      .map((turn) => turn.text)
      .join(" ");
    if (!reference) continue;
    for (const stage of ["S4", "S5"] as const)
      exercises.push({
        ...base(
          `${stage.toLowerCase()}.${block}`,
          stage,
          "oral",
          `block.${block}`,
          stage === "S4" ? "readAloud" : "recall",
          "oral",
        ),
        title: `${block} 段${stage === "S4" ? "朗读" : "回忆"}`,
        prompt:
          stage === "S4"
            ? "看着原文，清楚地读完整段。"
            : "合上原文，尝试说出这一段。",
        instruction: "录音后提交，由家长回听确认。",
        hint: reference,
        referenceText: reference,
        acceptedAnswers: [reference],
        speakText: stage === "S4" ? reference : undefined,
        exposureTargets: [
          ...exposure(block),
          {
            knowledgeId: `${record.id}.block.${block}`,
            ability: "recall",
            mode: "oral",
          },
        ],
      });
  }
  recipe.applications.forEach((item, index) =>
    exercises.push({
      ...base(
        `s7.${index}`,
        "S7",
        "sentence",
        `application.${index}`,
        "transfer",
        "written",
      ),
      title: "换个情境表达",
      prompt: item.prompt,
      instruction: "按指定情境写出短句。",
      hint: item.explanation,
      acceptedAnswers: item.answers,
    }),
  );
  return { course, exercises };
}
export function validateCourseRecord(
  value: unknown,
): asserts value is CourseRecord {
  const record = value as CourseRecord;
  if (
    !record ||
    !/^user\.[a-f0-9]{32}$/.test(record.id) ||
    !text(record.title, 100, true) ||
    !text(record.subtitle, 120, true) ||
    !text(record.sourceText, 6000, true) ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    (record.deletedAt !== undefined &&
      (typeof record.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(record.deletedAt)))) ||
    !Object.keys(courseStatusLabels).includes(record.status)
  )
    fail("课程草稿数据损坏，已停止写入。");
  for (const images of [record.images, record.vocabularyImages])
    if (
      !Array.isArray(images) ||
      images.length > 6 ||
      images.some(
        (image) =>
          !image ||
          !/^course-images\/[a-f0-9-]{36}\.jpg$/.test(image.path) ||
          ![0, 90, 180, 270].includes(image.rotation),
      )
    )
      fail("课程图片引用无效。");
  validateVocabulary(
    record.vocabulary,
    record.status === "source" || record.status === "vocabulary",
  );
  if (record.status !== "source") {
    if (!record.title.trim()) fail("请填写课程标题。");
    sourceTurns(record.sourceText);
  }
  if (
    ["generation", "review", "published"].includes(record.status) &&
    (!record.vocabulary.some((word) => word.selected) ||
      record.vocabulary.some((word) => word.selected && !word.meaning.trim()))
  )
    fail("重点词汇尚未确认。");
  if (["review", "published"].includes(record.status)) {
    const expected = buildCoursePackage(record);
    if (
      !record.package ||
      JSON.stringify(record.package) !== JSON.stringify(expected)
    )
      fail("生成课程与已确认内容不一致，请重新生成。");
  } else if (record.package !== null || record.recipe !== null)
    fail("草稿步骤与生成结果不一致。");
}
