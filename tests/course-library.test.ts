import { describe, expect, it } from "vitest";
import {
  buildCoursePackage,
  newCourse,
  validateCourseRecord,
  modelVocabulary,
  parseModelJSON,
  sourceTurns,
  type CourseRecord,
} from "../src/course-library";
import { decodeState, emptyState } from "../src/storage";
import { gradeExercise } from "../packages/learning-engine/src";
import { exercises as starterExercises } from "../src/course";
import {
  removeCourse,
  archiveCourse,
  restoreCourse,
  purgeCourse,
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

  it("soft deletion and restoration preserve all course content and learning facts without resource cleanup", () => {
    const state = emptyState(),
      record = sampleCourse();
    state.courses = [record];
    const now = new Date().toISOString();
    state.learners = [{ id: "child", nickname: "小树", createdAt: now }];
    state.activeLearnerId = "child";
    state.learningCourseIds = { child: record.id };
    state.confirmedCourses = [
      {
        learnerId: "child",
        courseId: record.id,
        version: record.package!.course.version,
      },
    ];
    const exercise = record.package!.exercises[0]!;
    state.runs = [
      {
        id: "run",
        learnerId: "child",
        courseId: record.id,
        stageId: "S1",
        exerciseIds: [exercise.id],
        index: 0,
        label: "读懂故事",
        answer: "原草稿",
        selectedIds: [],
        hints: {},
        recordingPath: null,
      },
    ];
    state.events = [
      {
        id: "exposure",
        type: "exposure",
        learnerId: "child",
        at: now,
        targets: [exercise.target],
      },
    ];
    const before = structuredClone(state);
    archiveCourse(state, record.id);
    expect(state.learningCourseIds).toEqual({});
    expect(state.events).toEqual(before.events);
    expect(state.runs).toEqual(before.runs);
    expect(state.confirmedCourses).toEqual(before.confirmedCourses);
    expect(state.pendingCourseDeletions).toEqual([]);
    const reloaded = decodeState(JSON.stringify(state));
    expect(reloaded.courses[0]!.deletedAt).toBeTruthy();
    const invalid = structuredClone(reloaded);
    invalid.learningCourseIds.child = record.id;
    expect(() => decodeState(JSON.stringify(invalid))).toThrow("引用无效");
    restoreCourse(reloaded, record.id);
    expect(reloaded.courses).toEqual(before.courses);
    expect(reloaded.learningCourseIds).toEqual({});
    expect(decodeState(JSON.stringify(reloaded)).runs).toEqual(before.runs);
    expect(() => archiveCourse(state, record.id)).toThrow();
  });
  it("restores original draft steps, rejects malformed timestamps and respects the active course limit", () => {
    const state = emptyState(),
      draft = newCourse();
    state.courses = [draft];
    archiveCourse(state, draft.id);
    const bad = structuredClone(state);
    bad.courses[0]!.deletedAt = "invalid";
    expect(() => decodeState(JSON.stringify(bad))).toThrow("损坏");
    state.courses.push(...Array.from({ length: 30 }, () => newCourse()));
    expect(() => restoreCourse(state, draft.id)).toThrow("已满");
    expect(decodeState(JSON.stringify(state)).courses).toHaveLength(31);
    archiveCourse(state, state.courses[1]!.id);
    restoreCourse(state, draft.id);
    expect(state.courses[0]!.status).toBe("source");
    expect(state.courses[0]!.deletedAt).toBeUndefined();
  });
  it("deletes one course across children, reviews, mixed exposures and recovery points while preserving other courses", () => {
    const state = emptyState(),
      first = sampleCourse(),
      second = sampleCourse();
    const time = new Date().toISOString();
    state.courses = [first, second];
    state.learners = ["child-a", "child-b"].map((id) => ({
      id,
      nickname: id,
      createdAt: time,
    }));
    state.activeLearnerId = "child-a";
    state.learningCourseIds = { "child-a": first.id, "child-b": first.id };
    state.confirmedCourses = state.learners.map((learner) => ({
      learnerId: learner.id,
      courseId: first.id,
      version: first.package!.course.version,
    }));
    const oral = first.package!.exercises.find((item) => item.kind === "oral")!;
    const other = second.package!.exercises[0]!;
    const attempt = (
      id: string,
      exercise: Exercise,
      learnerId: string,
      recordingPath: string | null,
    ): LearningEvent => ({
      id: `event-${id}`,
      type: "attempt",
      learnerId,
      at: time,
      attempt: {
        id,
        clientEventId: id,
        learnerId,
        sessionId: `session-${id}`,
        exerciseId: exercise.id,
        answer: "",
        selectedIds: [],
        recordingPath,
        hintLevel: 0,
        firstTest: true,
        submittedAt: time,
        localDate: time.slice(0, 10),
        timezone: "UTC",
        clockStatus: "normal",
        grade: gradeExercise(exercise, {
          answer: "",
          selectedIds: [],
          recordingPath,
        }),
      },
    });
    state.events = [
      attempt("one", oral, "child-a", "recordings/child-a/one.m4a"),
      attempt("two", oral, "child-b", "recordings/child-b/two.m4a"),
      attempt("other", other, "child-a", null),
      {
        id: "review",
        type: "review",
        learnerId: "child-a",
        at: time,
        attemptId: "one",
        passed: true,
        expectedRevision: 0,
      },
      {
        id: "mixed",
        type: "exposure",
        learnerId: "child-a",
        at: time,
        targets: [oral.target, other.target],
      },
      {
        id: "only",
        type: "exposure",
        learnerId: "child-b",
        at: time,
        targets: [oral.target],
      },
    ];
    const run = (id: string, exercise: Exercise, courseId: string) => ({
      id,
      learnerId: "child-a",
      courseId,
      stageId: exercise.stageId,
      exerciseIds: [exercise.id],
      index: 0,
      label: "",
      hints: {},
      answer: "",
      selectedIds: [],
      recordingPath: null,
    });
    state.runs = [
      run("deleted-run", oral, first.id),
      run("kept-run", other, second.id),
    ];
    const image = {
      path: "course-images/12345678-1234-1234-1234-123456789abc.jpg",
      rotation: 0 as const,
    };
    const shared = {
      path: "course-images/12345678-1234-1234-1234-123456789def.jpg",
      rotation: 0 as const,
    };
    first.images = [image, shared];
    second.images = [shared];
    expect(() => purgeCourse(state, first.id)).toThrow("已删除列表");
    archiveCourse(state, first.id);
    const deletion = purgeCourse(state, first.id);
    expect(() => restoreCourse(state, first.id)).toThrow("不在已删除");
    expect(deletion.images).toEqual([image.path]);
    expect(deletion.recordings).toEqual([
      "recordings/child-a/one.m4a",
      "recordings/child-b/two.m4a",
    ]);
    expect(state.learningCourseIds).toEqual({});
    expect(state.confirmedCourses).toEqual([]);
    expect(state.events.map((event) => event.id)).toEqual([
      "event-other",
      "mixed",
    ]);
    expect(state.runs.map((item) => item.id)).toEqual(["kept-run"]);
    expect(decodeState(JSON.stringify(state)).courses[0]!.id).toBe(second.id);
    expect(state.learners).toHaveLength(2);
    expect(() => removeCourse(state, "starter.unit1.lesson1")).toThrow(
      "内置课程",
    );
    const invalid = structuredClone(state);
    invalid.pendingCourseDeletions[0]!.images = ["../secret.jpg"];
    expect(() => decodeState(JSON.stringify(invalid))).toThrow("删除恢复");
  });
  it("removes incomplete drafts and migrates snapshots without the new cleanup queue", () => {
    const state = emptyState(),
      draft = newCourse();
    state.courses = [draft];
    removeCourse(state, draft.id);
    expect(decodeState(JSON.stringify(state)).courses).toHaveLength(0);
    const prior: any = emptyState();
    delete prior.pendingCourseDeletions;
    expect(decodeState(JSON.stringify(prior)).pendingCourseDeletions).toEqual(
      [],
    );
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
  it("migrates version-one snapshots without losing profiles, confirmations or recovery data and preserves bad input", () => {
    const state = emptyState();
    const legacy: any = {
      ...state,
      formatVersion: 1,
      learners: [
        {
          id: "old-child",
          nickname: "小树",
          createdAt: new Date().toISOString(),
        },
      ],
      activeLearnerId: "old-child",
      confirmedLearnerIds: ["old-child"],
    };
    delete legacy.courses;
    delete legacy.learningCourseIds;
    delete legacy.confirmedCourses;
    const exercise = starterExercises[0]!;
    const time = new Date().toISOString();
    legacy.events = [
      {
        id: "old-event",
        type: "attempt",
        learnerId: "old-child",
        at: time,
        attempt: {
          id: "old-attempt",
          clientEventId: "old-client",
          learnerId: "old-child",
          sessionId: "old-run",
          exerciseId: exercise.id,
          answer: "",
          selectedIds: exercise.correctOptionIds,
          recordingPath: null,
          hintLevel: 0,
          firstTest: true,
          submittedAt: time,
          localDate: time.slice(0, 10),
          timezone: "UTC",
          clockStatus: "normal",
          grade: gradeExercise(exercise, {
            answer: "",
            selectedIds: exercise.correctOptionIds!,
          }),
        },
      },
    ];
    legacy.runs = [
      {
        id: "old-run",
        learnerId: "old-child",
        stageId: "S1",
        exerciseIds: [exercise.id],
        index: 0,
        label: "旧练习",
        hints: {},
        answer: "",
        selectedIds: exercise.correctOptionIds,
        recordingPath: null,
      },
    ];
    const input = JSON.stringify(legacy);
    const migrated = decodeState(input);
    expect(migrated.formatVersion).toBe(2);
    expect(migrated.learners).toEqual(legacy.learners);
    expect(migrated.events).toEqual(legacy.events);
    expect(migrated.runs[0]).toMatchObject({
      id: "old-run",
      courseId: "starter.unit1.lesson1",
      index: 0,
    });
    expect(migrated.confirmedCourses[0]).toMatchObject({
      learnerId: "old-child",
      courseId: "starter.unit1.lesson1",
    });
    expect(JSON.stringify(legacy)).toBe(input);
    expect(() =>
      decodeState(JSON.stringify({ ...legacy, courseVersion: "99" })),
    ).toThrow();
    const course = sampleCourse();
    const library = emptyState();
    library.courses.push(course);
    expect(
      decodeState(JSON.stringify(library)).courses[0]!.package!.exercises
        .length,
    ).toBeGreaterThan(6);
    library.learningCourseIds["missing-child"] = course.id;
    expect(() => decodeState(JSON.stringify(library))).toThrow("引用无效");
  });
});
