import { describe, expect, it } from "vitest";
import {
  buildReviewQueue,
  cellKey,
  gradeExercise,
  projectLearning,
} from "../packages/learning-engine/src";
import type {
  Attempt,
  Exercise,
  LearningEvent,
} from "../packages/learning-engine/src/model";

const learner = "child-a";
const at = (day: number, hour = 9): string =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const word = (id = "word-a", familyId = id): Exercise => ({
  id,
  familyId,
  stageId: "S2",
  kind: "spelling",
  title: "篮球",
  prompt: "篮球",
  instruction: "写出英文",
  hint: "b…",
  acceptedAnswers: ["basketball"],
  threshold: 100,
  target: { knowledgeId: "basketball", ability: "spelling", mode: "written" },
});
function attempt(
  exercise: Exercise,
  id: string,
  time: string,
  overrides: Partial<Attempt> = {},
): LearningEvent {
  const response = {
    answer: "basketball",
    selectedIds: [] as string[],
    recordingPath: exercise.kind === "oral" ? "recordings/one.m4a" : null,
  };
  const data: Attempt = {
    id,
    clientEventId: `client-${id}`,
    learnerId: learner,
    sessionId: `session-${id}`,
    exerciseId: exercise.id,
    ...response,
    hintLevel: 0,
    firstTest: true,
    submittedAt: time,
    localDate: time.slice(0, 10),
    timezone: "UTC",
    clockStatus: "normal",
    grade: gradeExercise(exercise, response),
    ...overrides,
  };
  return {
    id: `event-${id}`,
    type: "attempt",
    learnerId: data.learnerId,
    at: time,
    attempt: data,
  };
}
function review(
  id: string,
  attemptId: string,
  passed: boolean,
  expectedRevision = 0,
  time = at(20),
): LearningEvent {
  return {
    id,
    type: "review",
    learnerId: learner,
    at: time,
    attemptId,
    passed,
    expectedRevision,
  };
}
function exposure(id: string, exercise: Exercise, time: string): LearningEvent {
  return {
    id,
    type: "exposure",
    learnerId: learner,
    at: time,
    targets: [exercise.target],
  };
}
const firstSkill = (
  events: LearningEvent[],
  exercises: Exercise[],
  now = at(11),
) => projectLearning(events, exercises, learner, now).skills[0];

describe("deterministic local grading", () => {
  it("requires the exact choice set and rejects duplicate option ids", () => {
    const exercise: Exercise = {
      ...word(),
      kind: "choice",
      correctOptionIds: ["a", "b"],
    };
    expect(
      gradeExercise(exercise, { answer: "", selectedIds: ["b", "a"] }).passed,
    ).toBe(true);
    expect(
      gradeExercise(exercise, { answer: "", selectedIds: ["a"] }).passed,
    ).toBe(false);
    expect(
      gradeExercise(exercise, { answer: "", selectedIds: ["a", "a"] }).passed,
    ).toBe(false);
    expect(
      gradeExercise(exercise, { answer: "", selectedIds: ["a", "b", "c"] })
        .passed,
    ).toBe(false);
  });

  it("checks ordered token ids, including identity rather than visible text", () => {
    const exercise: Exercise = {
      ...word(),
      kind: "order",
      correctTokenIds: ["subject", "verb", "object"],
    };
    expect(
      gradeExercise(exercise, {
        answer: "",
        selectedIds: ["subject", "verb", "object"],
      }).passed,
    ).toBe(true);
    expect(
      gradeExercise(exercise, {
        answer: "",
        selectedIds: ["subject", "object", "verb"],
      }).passed,
    ).toBe(false);
  });

  it("normalizes text but never accepts a nearly correct spelling", () => {
    const miss = gradeExercise(word(), {
      answer: "basketbal",
      selectedIds: [],
    });
    expect(miss.score).toBe(90);
    expect(miss.passed).toBe(false);
    expect(
      gradeExercise(word(), {
        answer: "  ＢＡＳＫＥＴＢＡＬＬ  ",
        selectedIds: [],
      }).passed,
    ).toBe(true);
    expect(
      gradeExercise(word(), { answer: "basket ball", selectedIds: [] }).passed,
    ).toBe(false);
    expect(gradeExercise(word(), { answer: "", selectedIds: [] }).score).toBe(
      0,
    );
  });

  it("protects negation even when a long sentence otherwise clears its numeric threshold", () => {
    const exercise: Exercise = {
      ...word(),
      kind: "sentence",
      threshold: 85,
      acceptedAnswers: [
        "I am not going to play basketball with my friends after school today.",
      ],
    };
    const result = gradeExercise(exercise, {
      answer:
        "I am going to play basketball with my friends after school today.",
      selectedIds: [],
    });
    expect(result.score).toBeGreaterThan(85);
    expect(result.passed).toBe(false);
    expect(
      gradeExercise(
        { ...exercise, acceptedAnswers: ["No, I won't."] },
        { answer: "No, I will.", selectedIds: [] },
      ).passed,
    ).toBe(false);
  });

  it("checks whole critical tokens rather than substring presence", () => {
    const exercise: Exercise = {
      ...word(),
      kind: "sentence",
      threshold: 50,
      acceptedAnswers: ["I like playing basketball."],
      criticalTokens: ["basketball"],
    };
    expect(
      gradeExercise(exercise, {
        answer: "I like playing football.",
        selectedIds: [],
      }).passed,
    ).toBe(false);
    expect(
      gradeExercise(exercise, {
        answer: "I like playing basketballs.",
        selectedIds: [],
      }).passed,
    ).toBe(false);
    expect(
      gradeExercise(exercise, {
        answer: "I like playing basketball.",
        selectedIds: [],
      }).passed,
    ).toBe(true);
  });

  it("does not invent a pronunciation grade from a recording path", () => {
    const exercise: Exercise = { ...word(), kind: "oral" };
    expect(
      gradeExercise(exercise, {
        answer: "",
        selectedIds: [],
        recordingPath: "a.m4a",
      }),
    ).toMatchObject({ status: "needs_review", score: null, passed: null });
    expect(
      gradeExercise(exercise, { answer: "", selectedIds: [] }),
    ).toMatchObject({ status: "unscorable", score: null, passed: null });
  });
});

describe("event projection, qualification and mastery", () => {
  it("deduplicates event id, attempt id and clientEventId independently", () => {
    const exercise = word();
    const original = attempt(exercise, "a", at(11));
    const duplicateClient = attempt(exercise, "b", at(12), {
      clientEventId: "client-a",
    });
    const duplicateAttempt = attempt(exercise, "a", at(13), {
      clientEventId: "client-distinct",
    });
    const projection = projectLearning(
      [
        original,
        original,
        duplicateClient,
        { ...duplicateAttempt, id: "different-event" },
      ],
      [exercise],
      learner,
      at(14),
    );
    expect(projection.attempts).toHaveLength(1);
    expect(projection.skills[0]).toMatchObject({
      alpha: 2,
      beta: 1,
      evidenceCount: 1,
      effectiveWeight: 1,
      status: "learning",
    });
  });

  it("isolates learners even if their event ids collide", () => {
    const exercise = word();
    const other = attempt(exercise, "a", at(11), { learnerId: "child-b" });
    const own = attempt(exercise, "a", at(11));
    const projection = projectLearning(
      [other, own],
      [exercise],
      learner,
      at(11),
    );
    expect(projection.attempts).toHaveLength(1);
    expect(projection.attempts[0].learnerId).toBe(learner);
    expect(projection.skills[0].effectiveWeight).toBe(1);
  });

  it("excludes hints and corrections, including after a human marks them correct", () => {
    const exercise = word();
    const events = [
      attempt(exercise, "hint1", at(11), { hintLevel: 1 }),
      attempt(exercise, "hint3", at(12), { hintLevel: 3 }),
      attempt(exercise, "retry", at(13), { firstTest: false }),
      review("manual", "hint1", true),
    ];
    expect(firstSkill(events, [exercise])).toMatchObject({
      alpha: 1,
      beta: 1,
      evidenceCount: 0,
      latestPassed: null,
      status: "unmeasured",
    });
  });

  it("counts the earliest family/day test but still exposes a later independent failure", () => {
    const exercise = word();
    const wrong = gradeExercise(exercise, {
      answer: "basketbal",
      selectedIds: [],
    });
    const state = firstSkill(
      [
        attempt(exercise, "a", at(11)),
        attempt(exercise, "b", at(11, 10), {
          grade: wrong,
          answer: "basketbal",
        }),
      ],
      [exercise],
    );
    expect(state).toMatchObject({
      alpha: 2,
      beta: 1,
      evidenceCount: 1,
      latestPassed: false,
      status: "review_due",
    });
  });

  it("truncates remaining daily weight and never hides a failure beyond the cap", () => {
    const choice: Exercise = {
      ...word("a"),
      kind: "choice",
      correctOptionIds: ["yes"],
    };
    const b = word("b");
    const c = word("c");
    const d = word("d");
    const state = firstSkill(
      [
        attempt(choice, "a", at(11), {
          selectedIds: ["yes"],
          grade: gradeExercise(choice, { answer: "", selectedIds: ["yes"] }),
        }),
        attempt(b, "b", at(11, 10)),
        attempt(c, "c", at(11, 11)),
        attempt(d, "d", at(11, 12), {
          grade: gradeExercise(d, { answer: "wrong", selectedIds: [] }),
        }),
      ],
      [choice, b, c, d],
    );
    expect(state).toMatchObject({
      effectiveWeight: 2,
      alpha: 3,
      beta: 1,
      evidenceCount: 3,
      latestPassed: false,
      status: "review_due",
    });
  });

  it("requires independent families, enough weight and an absolute delayed pass", () => {
    const a = word("a");
    const b = word("b");
    expect(firstSkill([attempt(a, "a", at(11))], [a, b]).status).toBe(
      "learning",
    );
    const mature = [
      attempt(a, "a", at(11)),
      attempt(b, "b", at(11, 10)),
      attempt(a, "c", at(12, 11)),
    ];
    expect(firstSkill(mature, [a, b], at(12, 12))).toMatchObject({
      mastery: 0.8,
      status: "mastered",
      delayedPass: true,
      reviewLevel: 1,
      dueAt: at(15, 11),
    });
    const sameFamily = [
      attempt(a, "a", at(11)),
      attempt(a, "b", at(12)),
      attempt(a, "c", at(13)),
    ];
    expect(firstSkill(sameFamily, [a], at(13)).status).toBe("learning");
  });

  it("does not let a two-minute date change grant a 24-hour delay", () => {
    const a = word("a");
    const b = word("b");
    const events = [
      attempt(a, "a", "2026-10-11T23:59:00.000Z"),
      attempt(b, "b", "2026-10-12T00:01:00.000Z"),
    ];
    expect(firstSkill(events, [a, b], at(12))).toMatchObject({
      delayedPass: false,
      reviewLevel: 0,
      dueAt: "2026-10-12T23:59:00.000Z",
    });
  });

  it("leaves dueAt unchanged after early practice and after answer exposure", () => {
    const a = word("a");
    const b = word("b");
    const events = [
      attempt(a, "a", at(11)),
      attempt(b, "b", at(11, 20)),
      exposure("reveal", a, at(12, 18)),
    ];
    const projection = projectLearning(events, [a, b], learner, at(12, 19));
    expect(projection.skills[0]).toMatchObject({
      dueAt: at(12),
      eligibleAt: at(13, 18),
      reviewLevel: 0,
      delayedPass: false,
    });
    expect(buildReviewQueue(projection, [a, b], at(12, 19))).toEqual([]);
  });

  it("processes same-time feedback after the submitted delayed test", () => {
    const a = word("a");
    const b = word("b");
    const events = [
      attempt(a, "a", at(11)),
      exposure("feedback-a", a, at(11)),
      attempt(b, "b", at(12)),
      exposure("feedback-b", b, at(12)),
    ];
    expect(firstSkill(events, [a, b], at(12))).toMatchObject({
      reviewLevel: 1,
      delayedPass: true,
      dueAt: at(15),
      eligibleAt: at(13),
    });
  });

  it("applies review CAS, ignores stale decisions and replaces rather than adds evidence", () => {
    const exercise: Exercise = {
      ...word(),
      kind: "oral",
      target: { knowledgeId: "block-A", ability: "readAloud", mode: "oral" },
    };
    const events = [
      attempt(exercise, "a", at(11)),
      review("r1", "a", false),
      review("stale", "a", true),
    ];
    const failed = projectLearning(events, [exercise], learner, at(20));
    expect(failed.attempts[0]).toMatchObject({
      reviewRevision: 1,
      grade: { passed: false, source: "human" },
    });
    expect(failed.skills[0]).toMatchObject({
      alpha: 1,
      beta: 2,
      evidenceCount: 1,
      effectiveWeight: 1,
      dueAt: at(12),
    });
    const success = projectLearning(
      [...events, review("r2", "a", true, 1), review("r2", "a", true, 1)],
      [exercise],
      learner,
      at(20),
    );
    expect(success.attempts[0].reviewRevision).toBe(2);
    expect(success.skills[0]).toMatchObject({
      alpha: 2,
      beta: 1,
      evidenceCount: 1,
      effectiveWeight: 1,
    });
  });

  it("does not permit a review event to replace a deterministic text grade", () => {
    const exercise = word();
    const projection = projectLearning(
      [attempt(exercise, "a", at(11)), review("unsupported", "a", false)],
      [exercise],
      learner,
      at(20),
    );
    expect(projection.attempts[0]).toMatchObject({
      reviewRevision: 0,
      grade: { passed: true, source: "local" },
    });
  });

  it("records exposure anchors without making unseen cells due", () => {
    const exercise = word();
    expect(
      firstSkill([exposure("looked", exercise, at(11))], [exercise], at(20)),
    ).toMatchObject({ dueAt: null, eligibleAt: at(12), status: "unmeasured" });
  });

  it("credits late oral reviews to original submissions, requiring three independent days and sessions", () => {
    const oral: Exercise = {
      ...word("read"),
      kind: "oral",
      target: { knowledgeId: "sentence-1", ability: "readAloud", mode: "oral" },
    };
    const events = [
      attempt(oral, "a", at(11)),
      attempt(oral, "b", at(12)),
      attempt(oral, "c", at(13)),
      review("r1", "a", true),
      review("r2", "b", true),
      review("r3", "c", true),
    ];
    const state = firstSkill(events, [oral], at(20));
    expect(state).toMatchObject({
      alpha: 4,
      beta: 1,
      effectiveWeight: 3,
      evidenceCount: 3,
      reviewLevel: 1,
      dueAt: at(15),
      delayedPass: true,
      status: "review_due",
    });
    expect(firstSkill(events, [oral], at(14)).status).toBe("mastered");
    const oneSession = events.map((event) =>
      event.type === "attempt"
        ? { ...event, attempt: { ...event.attempt, sessionId: "one-session" } }
        : event,
    );
    expect(firstSkill(oneSession, [oral], at(14)).status).toBe("learning");
  });

  it("cannot form mastery from suspect clock dates", () => {
    const a = word("a");
    const b = word("b");
    const events = [
      attempt(a, "a", at(11), { clockStatus: "suspect" }),
      attempt(b, "b", at(12), { clockStatus: "suspect" }),
      attempt(a, "c", at(13), { clockStatus: "suspect" }),
    ];
    expect(firstSkill(events, [a, b], at(14))).toMatchObject({
      mastery: 0.8,
      delayedPass: false,
      reviewLevel: 0,
      status: "learning",
    });
  });

  it("preserves journal order when a rolled-back clock reports an earlier timestamp", () => {
    const a = word("a");
    const b = word("b");
    const events = [
      attempt(a, "first", at(12)),
      attempt(b, "latest", at(11), {
        clockStatus: "suspect",
        grade: gradeExercise(b, { answer: "wrong", selectedIds: [] }),
      }),
    ];
    const projection = projectLearning(events, [a, b], learner, at(12));
    expect(projection.attempts.map((item) => item.id)).toEqual([
      "first",
      "latest",
    ]);
    expect(projection.skills[0]).toMatchObject({
      latestPassed: false,
      status: "review_due",
      delayedPass: false,
    });
  });

  it("requires a fresh delayed pass after a failure even if a later practice passes", () => {
    const a = word("a");
    const b = word("b");
    const c = word("c");
    const events = [
      attempt(a, "a", at(11)),
      attempt(b, "b", at(11, 10)),
      attempt(a, "c", at(12, 11)),
      attempt(b, "d", at(12, 12), {
        grade: gradeExercise(b, { answer: "wrong", selectedIds: [] }),
      }),
      attempt(c, "e", at(12, 13)),
    ];
    expect(firstSkill(events, [a, b, c], at(12, 14))).toMatchObject({
      latestPassed: true,
      delayedPass: false,
      reviewLevel: 0,
      dueAt: at(13, 12),
      status: "learning",
    });
  });

  it("does not mix two abilities for the same word and generates a stable per-cell queue", () => {
    const spelling = word();
    const meaning: Exercise = {
      ...word("meaning"),
      stageId: "S1",
      kind: "choice",
      correctOptionIds: ["yes"],
      target: { ...spelling.target, ability: "meaning", mode: "recognition" },
    };
    const events = [attempt(spelling, "a", at(11))];
    const one = projectLearning(events, [spelling, meaning], learner, at(11));
    const two = projectLearning(events, [spelling, meaning], learner, at(11));
    expect(one).toEqual(two);
    expect(
      one.skills.find((skill) => skill.key === cellKey(meaning.target))?.status,
    ).toBe("unmeasured");
    expect(
      buildReviewQueue(one, [spelling, meaning], at(11)).map(
        (exercise) => exercise.id,
      ),
    ).toEqual(["meaning"]);
    expect(
      buildReviewQueue(one, [spelling, meaning], at(12)).map(
        (exercise) => exercise.id,
      ),
    ).toEqual([spelling.id, meaning.id]);
  });
});
