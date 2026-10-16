import type {
  Exercise,
  CellRef,
  StageId,
} from "./model";
import type { Course, StageView, DialogueTurn } from "./model";

const turns: DialogueTurn[] = [
  {
    id: "t01",
    block: "A",
    speaker: "Wang Tao",
    text: "Look. We need new players for our basketball team. Who will join us?",
    translation: "看。我们的篮球队需要新队员。谁愿意加入我们？",
  },
  {
    id: "t02",
    block: "A",
    speaker: "Chen Hai",
    text: "I will. I like playing basketball.",
    translation: "我愿意。我喜欢打篮球。",
  },
  {
    id: "t03",
    block: "A",
    speaker: "Wang Tao",
    text: "Are you good at it?",
    translation: "你擅长打篮球吗？",
  },
  {
    id: "t04",
    block: "A",
    speaker: "Chen Hai",
    text: "Yes, I am. I often play basketball after school.",
    translation: "是的。我经常放学后打篮球。",
  },
  {
    id: "t05",
    block: "A",
    speaker: "Wang Tao",
    text: "Great!",
    translation: "太好了！",
  },
  {
    id: "t06",
    block: "B",
    speaker: "Yang Ming",
    text: "Hi, Ma Li! Will you join the football team?",
    translation: "你好，马丽！你愿意加入足球队吗？",
  },
  {
    id: "t07",
    block: "B",
    speaker: "Ma Li",
    text: "No, I won't. I'm not good at playing football.",
    translation: "不，我不愿意。我不擅长踢足球。",
  },
  {
    id: "t08",
    block: "B",
    speaker: "Yang Ming",
    text: "What's your favorite sport?",
    translation: "你最喜欢的运动是什么？",
  },
  {
    id: "t09",
    block: "B",
    speaker: "Ma Li",
    text: "My favorite sport is ping-pong.",
    translation: "我最喜欢的运动是乒乓球。",
  },
  {
    id: "t10",
    block: "B",
    speaker: "Yang Ming",
    text: "The ping-pong team is over there. You can go and have a look.",
    translation: "乒乓球队在那边。你可以去看一看。",
  },
  {
    id: "t11",
    block: "B",
    speaker: "Ma Li",
    text: "Thank you very much.",
    translation: "非常感谢。",
  },
  {
    id: "t12",
    block: "C",
    speaker: "Ma Li",
    text: "Is this the ping-pong team?",
    translation: "这里是乒乓球队吗？",
  },
  {
    id: "t13",
    block: "C",
    speaker: "Xia Yiyi",
    text: "Yes, it is. Will you join us?",
    translation: "是的。你愿意加入我们吗？",
  },
  {
    id: "t14",
    block: "C",
    speaker: "Ma Li",
    text: "Yes, I will. I want to learn more skills about playing ping-pong.",
    translation: "是的，我愿意。我想学习更多打乒乓球的技巧。",
  },
  {
    id: "t15",
    block: "C",
    speaker: "Xia Yiyi",
    text: "Great! You'll be a good player.",
    translation: "太好了！你会成为一名优秀的队员。",
  },
];

export const course: Course = {
  id: "starter.unit1.lesson1",
  version: "0.1.0",
  title: "一起加入运动队",
  subtitle: "Unit 1 · Lesson 1",
  description: "从读懂对话，到独立表达。每天一小步，让英语住进小窝。",
  turns,
};

// Preserve the 25 visible textbook sentences; generated practice never mutates these strings.
export const sentences = turns.flatMap((t) =>
  (t.text.match(/[^.!?]+[.!?]+/g) ?? [t.text]).map((text) => ({
    text: text.trim(),
    block: t.block,
  })),
);

export const stageDefinitions: Omit<
  StageView,
  "total" | "done" | "available" | "verified"
>[] = [
  { id: "S1", title: "读懂故事", subtitle: "理解三段课文在说什么", icon: "01" },
  { id: "S2", title: "认识单词", subtitle: "把运动与活动写出来", icon: "02" },
  { id: "S3", title: "搭好句子", subtitle: "练习邀请与介绍爱好", icon: "03" },
  { id: "S4", title: "开口朗读", subtitle: "看着课文，读给自己听", icon: "04" },
  {
    id: "S5",
    title: "试着回忆",
    subtitle: "合上课文，说出整段对话",
    icon: "05",
  },
  { id: "S6", title: "听写句子", subtitle: "听一听，再独立写下来", icon: "06" },
  { id: "S7", title: "换个情境", subtitle: "用学过的句型邀请朋友", icon: "07" },
];

const cell = (
  knowledgeId: string,
  ability: CellRef["ability"],
  mode: CellRef["mode"],
): CellRef => ({ knowledgeId, ability, mode });
const base = (
  id: string,
  stageId: StageId,
  kind: Exercise["kind"],
  target: CellRef,
): Exercise => ({
  id,
  stageId,
  kind,
  target,
  familyId: id,
  title: "",
  prompt: "",
  instruction: "",
  hint: "",
  acceptedAnswers: [],
  threshold: 100,
});
const blockDictationTargets = (block: DialogueTurn["block"]): CellRef[] =>
  sentences.flatMap((sentence, index) =>
    sentence.block === block
      ? [
          cell(
            `sentence.${String(index + 1).padStart(2, "0")}`,
            "dictation",
            "written",
          ),
        ]
      : [],
  );
const choices: Exercise[] = [
  {
    ...base(
      "s1-basketball",
      "S1",
      "choice",
      cell("story.A", "meaning", "recognition"),
    ),
    title: "谁想加入篮球队？",
    prompt: "回想 A 段对话，选择一位同学。",
    instruction: "选择一个答案",
    hint: "他说：I like playing basketball.",
    options: [
      { id: "chen", text: "Chen Hai" },
      { id: "mali", text: "Ma Li" },
      { id: "yiyi", text: "Xia Yiyi" },
    ],
    correctOptionIds: ["chen"],
  },
  {
    ...base(
      "s1-sport",
      "S1",
      "choice",
      cell("story.B", "meaning", "recognition"),
    ),
    title: "Ma Li 最喜欢哪项运动？",
    prompt: "回想 B 段对话。",
    instruction: "选择一个答案",
    hint: "她想去看看乒乓球队。",
    options: [
      { id: "football", text: "football" },
      { id: "pingpong", text: "ping-pong" },
      { id: "basketball", text: "basketball" },
    ],
    correctOptionIds: ["pingpong"],
  },
  {
    ...base(
      "s1-skills",
      "S1",
      "choice",
      cell("story.C", "meaning", "recognition"),
    ),
    title: "Ma Li 想学习什么？",
    prompt: "回想 C 段对话。",
    instruction: "选择一个答案",
    hint: "找一找 learn more skills 这句话。",
    options: [
      { id: "skills", text: "更多打乒乓球的技巧" },
      { id: "sing", text: "唱歌" },
      { id: "football", text: "踢足球" },
    ],
    correctOptionIds: ["skills"],
  },
];
choices.push(
  {
    ...base(
      "s1-after-school",
      "S1",
      "choice",
      cell("story.A", "meaning", "recognition"),
    ),
    title: "Chen Hai 什么时候打篮球？",
    prompt: "选择符合原文的一项。",
    instruction: "选择一个答案",
    hint: "找一找 after school。",
    options: [
      { id: "school", text: "放学后" },
      { id: "morning", text: "每天清晨" },
      { id: "weekend", text: "只在周末" },
    ],
    correctOptionIds: ["school"],
  },
  {
    ...base(
      "s1-football-no",
      "S1",
      "choice",
      cell("story.B", "meaning", "recognition"),
    ),
    title: "Ma Li 擅长踢足球吗？",
    prompt: "选择符合原文的一项。",
    instruction: "选择一个答案",
    hint: "留意 not good at。",
    options: [
      { id: "yes", text: "擅长" },
      { id: "no", text: "不擅长" },
    ],
    correctOptionIds: ["no"],
  },
  {
    ...base(
      "s1-join-yes",
      "S1",
      "choice",
      cell("story.C", "meaning", "recognition"),
    ),
    title: "Ma Li 愿意加入乒乓球队吗？",
    prompt: "选择她的回答。",
    instruction: "选择一个答案",
    hint: "Yes 表示肯定回答。",
    options: [
      { id: "no", text: "No, I won't." },
      { id: "yes", text: "Yes, I will." },
    ],
    correctOptionIds: ["yes"],
  },
);

const vocabulary = [
  ["basketball", "篮球"],
  ["football", "足球"],
  ["ping-pong", "乒乓球"],
  ["team", "队；团队"],
  ["player", "队员；运动员"],
  ["join", "加入"],
  ["favorite", "最喜欢的"],
  ["skill", "技巧"],
] as const;
const spelling: Exercise[] = vocabulary.map(([word, meaning]) => ({
  ...base(
    `s2-${word}`,
    "S2",
    "spelling",
    cell(`word.${word}`, "spelling", "written"),
  ),
  title: "把单词写下来",
  prompt: meaning,
  instruction: "输入英文单词。拼写需要完全正确。",
  hint: `首字母 ${word[0]} · 共 ${word.length} 个字符${word.includes("-") ? "（含连字符）" : ""}`,
  acceptedAnswers: [word],
  speakText: word,
}));
const wordContexts: Record<string, string> = {
  basketball: "I like playing _____.（篮球）",
  football: "I'm not good at playing _____.（足球）",
  "ping-pong": "My favorite sport is _____.（乒乓球）",
  team: "Will you join the football _____?（队）",
  player: "You'll be a good _____.（队员）",
  join: "Will you _____ us?（加入）",
  favorite: "My _____ sport is ping-pong.（最喜欢的）",
  skill: "I want to learn a new _____.（技巧，单数）",
};
spelling.push(
  ...vocabulary.map(([word]) => ({
    ...base(
      `s2-context-${word}`,
      "S2",
      "spelling",
      cell(`word.${word}`, "spelling", "written"),
    ),
    title: "让单词回到句子里",
    prompt: wordContexts[word]!,
    instruction: "只输入空缺的一个单词。",
    hint: `以 ${word[0]} 开头。`,
    acceptedAnswers: [word],
  })),
);

const ordered = (
  id: string,
  sentence: string,
  prompt: string,
  knowledgeId = id.replace("s3-", "pattern."),
): Exercise => {
  const tokens = sentence
    .split(" ")
    .map((text, i) => ({ id: `${id}-${i}`, text }));
  return {
    ...base(id, "S3", "order", cell(knowledgeId, "usage", "recognition")),
    title: "给句子排排队",
    prompt,
    instruction: "按顺序点击词块，再提交。再次点击已选词块可以撤回。",
    hint: `开头是 ${tokens[0]!.text}`,
    tokens: [
      ...tokens.filter((_, i) => i % 2 === 1),
      ...tokens.filter((_, i) => i % 2 === 0),
    ],
    correctTokenIds: tokens.map((t) => t.id),
    acceptedAnswers: [sentence],
    referenceText: sentence,
    exposureTargets: [cell(knowledgeId, "usage", "written")],
  };
};
const patterns: Exercise[] = [
  ordered("s3-invite", "Will you join us?", "你愿意加入我们吗？"),
  ordered(
    "s3-favorite",
    "My favorite sport is ping-pong.",
    "我最喜欢的运动是乒乓球。",
  ),
  ordered("s3-goodat", "I am good at playing basketball.", "我擅长打篮球。"),
  ordered(
    "s3-invite-team",
    "Will you join the football team?",
    "你愿意加入足球队吗？",
    "pattern.invite",
  ),
  ordered(
    "s3-favorite-basketball",
    "My favorite sport is basketball.",
    "我最喜欢的运动是篮球。",
    "pattern.favorite",
  ),
  ordered(
    "s3-goodat-football",
    "I am good at playing football.",
    "我擅长踢足球。",
    "pattern.goodat",
  ),
];
patterns.push(
  ...[
    ["invite", "你愿意加入我们吗？", "Will you join us?"],
    ["favorite", "我最喜欢的运动是乒乓球。", "My favorite sport is ping-pong."],
    ["goodat", "我擅长打篮球。", "I am good at playing basketball."],
  ].map(([key, prompt, text]) => ({
    ...base(
      `s3-write-${key}`,
      "S3",
      "sentence",
      cell(`pattern.${key}`, "usage", "written"),
    ),
    title: "独立写一句",
    prompt: prompt!,
    instruction: "不看词块，完整写出这句话。",
    hint: `开头是 ${text!.split(" ")[0]}。`,
    acceptedAnswers: [text!],
    criticalTokens: text!.replace(/[.!?]/g, "").split(" "),
    threshold: 90,
  })),
);
patterns.push(
  ...[
    ["invite", "你愿意加入足球队吗？", "Will you join the football team?"],
    ["favorite", "我最喜欢的运动是篮球。", "My favorite sport is basketball."],
    ["goodat", "我擅长踢足球。", "I am good at playing football."],
  ].map(([key, prompt, text]) => ({
    ...base(
      `s3-write-change-${key}`,
      "S3",
      "sentence",
      cell(`pattern.${key}`, "usage", "written"),
    ),
    title: "换个内容，再写一句",
    prompt: prompt!,
    instruction: "用已学句型独立写出这句话。",
    hint: `开头是 ${text!.split(" ")[0]}。`,
    acceptedAnswers: [text!],
    criticalTokens: text!.replace(/[.!?]/g, "").split(" "),
    threshold: 90,
  })),
);
const oral: Exercise[] = (["S4", "S5"] as const).flatMap((stageId) =>
  (["A", "B", "C"] as const).map((block) => {
    const text = turns
      .filter((t) => t.block === block)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");
    const spoken = turns
      .filter((t) => t.block === block)
      .map((t) => t.text)
      .join(" ");
    return {
      ...base(
        `${stageId.toLowerCase()}-${block}`,
        stageId,
        "oral",
        cell(
          `block.${block}`,
          stageId === "S4" ? "readAloud" : "recall",
          "oral",
        ),
      ),
      title: `${block} 段${stageId === "S4" ? "朗读" : "回忆"}`,
      prompt:
        stageId === "S4"
          ? text
          : `不看原文，说一说 ${block} 段的完整对话。可以请家长分别扮演不同角色。`,
      instruction: "录音后提交，稍后由家长听录音确认。本版不自动判断发音。",
      hint: turns
        .filter((t) => t.block === block)
        .map((t) => t.translation)
        .join("\n"),
      referenceText: text,
      speakText: spoken,
      acceptedAnswers: [spoken],
      exposureTargets: [
        cell(`block.${block}`, "recall", "oral"),
        ...blockDictationTargets(block),
      ],
    };
  }),
);

const dictation: Exercise[] = sentences.map(({ text, block }, i) => ({
  ...base(
    `s6-${String(i + 1).padStart(2, "0")}`,
    "S6",
    "sentence",
    cell(`sentence.${String(i + 1).padStart(2, "0")}`, "dictation", "written"),
  ),
  title: `听写 · 第 ${i + 1} 句`,
  prompt: `课文 ${block} 段 · 点击朗读，听清后输入。`,
  instruction: "使用设备英语音色。离线语音不可用时，可由家长对照原图朗读。",
  hint: `这句话有 ${text.split(" ").length} 个词。`,
  acceptedAnswers: [text],
  threshold: 90,
  speakText: text,
  referenceText: text,
  criticalTokens: [
    ...(/\bwon't\b/.test(text)
      ? ["won't"]
      : /\bnot\b/.test(text)
        ? ["not"]
        : []),
    ...(text.match(/\b(?:basketball|football|ping-pong)\b/g) ?? []),
    ...(/good at/.test(text) ? ["good at"] : []),
  ],
  exposureTargets: [cell(`block.${block}`, "recall", "oral")],
}));
const transfer: Exercise[] = [
  {
    ...base(
      "s7-invite",
      "S7",
      "sentence",
      cell("pattern.invite", "transfer", "written"),
    ),
    familyId: "transfer.invitation",
    title: "邀请新朋友",
    prompt:
      "你想邀请 Alex 加入你们的队伍。用 Will 开头写一句“你愿意加入我们吗？”",
    instruction: "按指定句型作答，本版按参考表达评分。",
    hint: "Will + you + 动词原形…?",
    acceptedAnswers: ["Will you join us?"],
    criticalTokens: ["will you join us"],
    threshold: 90,
  },
  {
    ...base(
      "s7-decline",
      "S7",
      "sentence",
      cell("pattern.reply", "transfer", "written"),
    ),
    familyId: "transfer.reply",
    title: "礼貌回答",
    prompt:
      "朋友问 Will you join the football team? 你决定不加入。用 No 开头简短回答。",
    instruction: "输入完整短句。缩写与完整形式均可。",
    hint: "用 will 的否定形式回答。",
    acceptedAnswers: ["No, I won't.", "No, I will not."],
    criticalTokens: ["no", "i", "will", "not"],
    threshold: 100,
  },
  {
    ...base(
      "s7-favorite",
      "S7",
      "sentence",
      cell("pattern.favorite", "transfer", "written"),
    ),
    familyId: "transfer.preference",
    title: "介绍你的爱好",
    prompt: "现在假设你最喜欢篮球。用 My favorite sport 开头介绍它。",
    instruction: "按指定句型作答，本版按参考表达评分。",
    hint: "My favorite sport + is + 运动名称。",
    acceptedAnswers: ["My favorite sport is basketball."],
    criticalTokens: ["my favorite sport is basketball"],
    threshold: 90,
  },
];
transfer.push(
  {
    ...base(
      "s7-invite-team",
      "S7",
      "sentence",
      cell("pattern.invite", "transfer", "written"),
    ),
    familyId: "transfer.complete-invitation",
    title: "邀请朋友加入足球队",
    prompt:
      "这次想邀请 Sam 加入足球队。用 Will 开头完整表达“你愿意加入足球队吗？”",
    instruction: "按指定句型作答，本版按参考表达评分。",
    hint: "Will you + join + the football team?",
    acceptedAnswers: ["Will you join the football team?"],
    criticalTokens: ["will you join the football team"],
    threshold: 90,
  },
  {
    ...base(
      "s7-accept",
      "S7",
      "sentence",
      cell("pattern.reply", "transfer", "written"),
    ),
    familyId: "transfer.positive-reply",
    title: "这一次，接受邀请",
    prompt: "朋友问 Will you join us? 你愿意。用 Yes 开头简短回答。",
    instruction: "输入完整短句。",
    hint: "使用 I will 回答。",
    acceptedAnswers: ["Yes, I will."],
    criticalTokens: ["yes", "i", "will"],
    threshold: 100,
  },
  {
    ...base(
      "s7-change-favorite",
      "S7",
      "sentence",
      cell("pattern.favorite", "transfer", "written"),
    ),
    familyId: "transfer.change-preference",
    title: "换一项最爱的运动",
    prompt:
      "把“My favorite sport is basketball.”改为最喜欢足球。写出完整句子。",
    instruction: "按指定句型作答。",
    hint: "用 football 替换原来的运动。",
    acceptedAnswers: ["My favorite sport is football."],
    criticalTokens: ["my favorite sport is football"],
    threshold: 90,
  },
);

export const exercises: Exercise[] = [
  ...choices,
  ...spelling,
  ...patterns,
  ...oral,
  ...dictation,
  ...transfer,
];
export const allExposureTargets: CellRef[] = [
  ...(["A", "B", "C"] as const).map((block) =>
    cell(`block.${block}`, "recall", "oral"),
  ),
  ...dictation.map((e) => e.target),
];
