const defaults = () => ({
  recognition: {
    baseUrl: "https://content.example.com/v1",
    model: "test-vision",
    hasKey: true,
  },
  generation: {
    baseUrl: "https://content.example.com/v1",
    model: "test-text",
    hasKey: true,
  },
});
let configuration =
  JSON.parse(sessionStorage.getItem("content-fixture") || "null") || defaults();
let epoch = 0,
  imageCount = 0;
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3WQAAAAASUVORK5CYII=";
export const contentNative = {
  getConfig: async () => configuration,
  saveConfig: async ({ kind, baseUrl, model, apiKey }) => {
    configuration[kind] = {
      baseUrl,
      model,
      hasKey: !!apiKey || configuration[kind].hasKey,
    };
    sessionStorage.setItem("content-fixture", JSON.stringify(configuration));
    return configuration[kind];
  },
  clearConfig: async ({ kind }) => {
    configuration[kind] = { baseUrl: "", model: "", hasKey: false };
    sessionStorage.setItem("content-fixture", JSON.stringify(configuration));
  },
  pickImage: async () => ({
    path: `course-images/00000000-0000-4000-a000-${String(++imageCount).padStart(12, "0")}.jpg`,
    rotation: 0,
  }),
  imageUrl: async () => ({ url: image }),
  cancelRequest: async () => {
    epoch++;
  },
  request: async ({ prompt }) => {
    const token = epoch;
    window.__contentRequests = (window.__contentRequests || 0) + 1;
    await new Promise((resolve) =>
      setTimeout(resolve, window.__contentDelay || 40),
    );
    if (token !== epoch) throw Error("处理已停止，草稿保留。");
    if (window.__contentFailure)
      throw Error("内容服务暂不可用，已保存的草稿保留。");
    if (window.__contentMalformed) return { text: '{"unexpected":true}' };
    if (prompt === "recognition-text" && window.__ocrLiteralLineBreaks)
      return { text: '{"text":"I love my family.\nMy mother is a teacher."}' };
    if (prompt === "recognition-text")
      return {
        text: JSON.stringify({
          ...(window.__ocrMetadata ?? {
            title: "My Family",
            subtitle: "Unit 2 · Lesson 1",
          }),
          text: window.__ocrUncertain
            ? "I love my [待校对].\nMy mother is a teacher."
            : "I love my family.\nMy mother is a teacher.",
        }),
      };
    if (prompt === "recognition-vocabulary")
      return {
        text: JSON.stringify({
          vocabulary: [
            { term: "family", meaning: "家庭", example: "" },
            { term: "teacher", meaning: "老师", example: "" },
          ],
        }),
      };
    if (prompt.startsWith("vocabulary:"))
      return {
        text: JSON.stringify({
          vocabulary: [
            { term: "family", meaning: "家庭", example: "I love my family." },
            {
              term: "mother",
              meaning: "妈妈",
              example: "My mother is a teacher.",
            },
          ],
        }),
      };
    const data = JSON.parse(prompt.slice("course:".length));
    return {
      text: JSON.stringify({
        translations: data.paragraphs.map((text) =>
          text.includes("mother") ? "我的妈妈是一位老师。" : "我爱我的家庭。",
        ),
        comprehension: [
          {
            question: "妈妈的职业是什么？",
            options: ["老师", "医生"],
            answerIndex: 0,
            explanation: "原文使用teacher。",
          },
        ],
        applications: [
          {
            prompt: "用 I love 表达你爱你的学校。",
            answers: ["I love my school."],
            explanation: "使用school替换family。",
          },
        ],
      }),
    };
  },
};
export const imageSource = async () => image;
export const contentRequest = async (kind, prompt, images = []) =>
  (await contentNative.request({ kind, prompt, images })).text;
export const recognitionPrompt = (vocabulary) =>
  vocabulary ? "recognition-vocabulary" : "recognition-text";
export const vocabularyPrompt = (source) => "vocabulary:" + source;
export const coursePrompt = (record, paragraphs) =>
  "course:" + JSON.stringify({ paragraphs, vocabulary: record.vocabulary });
