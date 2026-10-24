import { describe, expect, it } from "vitest";
import {
  buildCoursePackage,
  newCourse,
  validateCourseRecord,
  modelVocabulary,
  modelSource,
  parseModelJSON,
  sourceTurns,
  type CourseRecord,
} from "../src/course-library";
import { decodeState, emptyState } from "../src/storage";
import { gradeExercise } from "../packages/learning-engine/src";
import { exercises as starterExercises } from "../src/course";
import {
  removeCourse,
} from "../src/course-deletion";
import type {
  LearningEvent,
  Exercise,
} from "../packages/learning-engine/src/model";
export function sampleCourse(): CourseRecord {
  const record = newCourse();
  record.title = "My Family";
  record.sourceText = "I love my family. My mother is a teacher.";
  record.vocabulary = [
    {
      term: "family",
      meaning: "家庭",
      example: "I love my family.",
      selected: true,
      origin: "auto",
    },
  ];
  record.recipe = {
    translations: ["我爱我的家庭。我的妈妈是一位老师。"],
    comprehension: [
      {
        question: "妈妈的职业是什么？",
        options: ["老师", "医生"],
        answerIndex: 0,
        explanation: "原文写 teacher。",
      },
    ],
    applications: [
      {
        prompt: "用 I love 表达你爱你的学校。",
        answers: ["I love my school."],
        explanation: "用 school 替换 family。",
      },
    ],
  };
  record.package = buildCoursePackage(record);
  record.status = "published";
  return record;
}
describe("multi-course creation and durable migration", () => {
  it("extracts optional OCR metadata while accepting older text-only responses", () => {
    const text = "Lesson 1\nA Puma at large\nPumas are large animals.";
    expect(modelSource(JSON.stringify({ text, title: "  A Puma at large  ", subtitle: "Unit 1\nLesson 1" })))
      .toEqual({ text, title: "A Puma at large", subtitle: "Unit 1 Lesson 1" });
    expect(modelSource(JSON.stringify({ text }))).toEqual({ text, title: "", subtitle: "" });
    expect(modelSource(JSON.stringify({ text, title: null, subtitle: 123 })))
      .toEqual({ text, title: "", subtitle: "" });
    expect(modelSource(JSON.stringify({ text, title: "x".repeat(101), subtitle: "x".repeat(121) })))
      .toEqual({ text, title: "", subtitle: "" });
  });

  it("does not fill metadata from an unusable original recognition result", () => {
    for (const text of [undefined, "", "   ", "x".repeat(6001)])
      expect(() => modelSource(JSON.stringify({ text, title: "Title", subtitle: "Lesson 1" })))
        .toThrow("识别结果为空或过长");
  });

  it("preserves OCR paragraphs when a service returns literal control characters inside JSON strings", () => {
    const text = 'Lesson 1\nA Puma at large\n\nShe said, "Hello."\r\nOne\tTwo';
    const raw = JSON.stringify({ text }).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
    expect(parseModelJSON(raw)).toEqual({ text });
    expect(parseModelJSON("```json\n" + raw + "\n```")).toEqual({ text });
  });

  it("keeps valid JSON escapes and rejects unrelated malformed or truncated model output", () => {
    const text = 'A literal \\n, a backslash \\, and "quoted" text.\nNext paragraph.';
    expect(parseModelJSON(JSON.stringify({ text }))).toEqual({ text });
    const raw = JSON.stringify({ text }).replace('\\nNext', '\nNext');
    expect(parseModelJSON(raw)).toEqual({ text });
    for (const broken of ['{"text":"unfinished\nparagraph', 'Here is your text: {"text":"Hello"}', '{"text":"Hello",}', '{"text":"Hello"}{"text":"Other"}'])
      expect(() => parseModelJSON(broken)).toThrow("结构化内容");
  });





  it("removes only a mode course's events, confirmations and recovery data", () => {
    const state = emptyState(), first = sampleCourse(), second = sampleCourse();
    state.courses = [first, second];
    state.confirmedCourses = [{ learnerId: "child", courseId: first.id, version: first.package!.course.version }];
    removeCourse(state, first.id);
    expect(decodeState(JSON.stringify(state)).courses).toEqual([second]);
    expect(state.confirmedCourses).toEqual([]);
    expect(() => removeCourse(state, first.id)).not.toThrow();
  });
  it("removes course evidence for every child while retaining unrelated reviews and mixed exposure targets", () => {
    const state = emptyState(), first = sampleCourse(), second = sampleCourse();
    state.courses = [first, second];
    const at = new Date().toISOString();
    for (const [course, child, id] of [[first, "child-a", "first-a"], [first, "child-b", "first-b"], [second, "child-a", "second"]] as const) {
      const exercise = course.package!.exercises[0]!;
      const response = { answer: "", selectedIds: exercise.correctOptionIds!, recordingPath: null };
      state.events.push({ id: `event-${id}`, learnerId: child, type: "attempt", at,
        attempt: { id, clientEventId: id, sessionId: id, learnerId: child, exerciseId: exercise.id, ...response, hintLevel: 0,
          submittedAt: at, localDate: at.slice(0, 10), timezone: "UTC", clockStatus: "normal", firstTest: true, grade: gradeExercise(exercise, response) } });
      state.events.push({ id: `review-${id}`, learnerId: child, type: "review", at, attemptId: id, passed: true, expectedRevision: 0 });
      state.runs.push({ id, learnerId: child, courseId: course.id, stageId: "S1", exerciseIds: [exercise.id], index: 0, label: "测试", hints: {}, answer: "", selectedIds: [], recordingPath: null });
    }
    state.events.push({ id: "mixed", type: "exposure", learnerId: "child-a", at, targets: [first.package!.exercises[0]!.target, second.package!.exercises[0]!.target] });
    removeCourse(state, first.id);
    expect(state.events.map(item => item.id)).toEqual(["event-second", "review-second", "mixed"]);
    expect(state.events.at(-1)).toMatchObject({ targets: [second.package!.exercises[0]!.target] });
    expect(state.runs.map(item => item.id)).toEqual(["second"]);
    expect(() => decodeState(JSON.stringify(state))).not.toThrow();
  });
  it("rejects the obsolete combined snapshot rather than migrating public identities", () => {
    expect(() => decodeState(JSON.stringify({ ...emptyState(), learners: [], learningCourseIds: {} }))).toThrow("不受支持");
  });
  it("generates all seven stages only from confirmed text, words and reviewed recipe", () => {
    const record = sampleCourse();
    validateCourseRecord(record);
    expect(
      new Set(record.package!.exercises.map((item) => item.stageId)).size,
    ).toBe(7);
    expect(record.package!.course.turns[0]!.text).toBe(record.sourceText);
    expect(
      record.package!.exercises.every(
        (item) =>
          item.id.startsWith(record.id) &&
          item.target.knowledgeId.startsWith(record.id),
      ),
    ).toBe(true);
    const word = record.package!.exercises.find(
      (item) => item.kind === "spelling",
    )!;
    expect(
      gradeExercise(word, { answer: "family", selectedIds: [] }).passed,
    ).toBe(true);
    const malformed = structuredClone(record);
    malformed.package!.exercises[0]!.correctOptionIds = ["wrong"];
    expect(() => validateCourseRecord(malformed)).toThrow("不一致");
  });
  it("keeps incomplete manual vocabulary editable but blocks generation without selected terms and meanings", () => {
    const record = newCourse();
    record.title = "Draft";
    record.sourceText = "I love my family.";
    record.status = "vocabulary";
    record.vocabulary = [
      { term: "", meaning: "", example: "", selected: true, origin: "manual" },
    ];
    expect(() => validateCourseRecord(record)).not.toThrow();
    record.status = "generation";
    expect(() => validateCourseRecord(record)).toThrow();
    expect(() =>
      modelVocabulary(
        '{"vocabulary":[{"term":"<script>","meaning":"x"}]}',
        "auto",
      ),
    ).toThrow();
    expect(
      sourceTurns("Alice: Hello, Bob!\nBob: Hello, Alice!").map(
        (turn) => turn.speaker,
      ),
    ).toEqual(["Alice", "Bob"]);
  });

});
