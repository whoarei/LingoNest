import { describe, expect, it } from "vitest";
import type { PassageState, RuntimeContext } from "../packages/learning-modes/passage-path/model";
import { projectGoalProgress } from "../packages/learning-modes/passage-path/progress";
import { questionFor } from "../packages/learning-modes/passage-path/references";
import { passageReport } from "../packages/learning-modes/passage-path/reporting";
import { publishPassagePackage, transitionPassage } from "../packages/learning-modes/passage-path/runtime";
import { decodePassageState, emptyPassageState } from "../packages/learning-modes/passage-path/state";
import { approve, context, finishSession, fixtureDraft, fixturePackage, responseFor, started } from "./fixtures/passage-path";

describe("passage-path sessions", () => {
  it("records original exposure after feedback and with missing audio without altering the submitted fact", () => {
    const ctx = context(); let state = started();
    state = transitionPassage(state, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "before-original", response: responseFor(state, "session-1") });
    const fact = structuredClone(state.attempts[0]);
    const unavailable = { ...ctx, courses: ctx.courses.map(course => ({ ...course, audioReady: false })) };
    state = transitionPassage(state, unavailable, { type: "assist", sessionId: "session-1", index: 0 });
    expect(state.sessions[0]!.assistedGoals.length).toBeGreaterThan(0);
    expect(state.attempts[0]).toEqual(fact);
    expect(() => transitionPassage(state, unavailable, { type: "next", sessionId: "session-1", index: 0 })).toThrow("音频");
    expect(decodePassageState(JSON.stringify(state))).toEqual(state);
  });
  it("freezes a deterministic mixed queue, introduces meaning before recall, and restores partial input and feedback", () => {
    const ctx = context();
    const original = approve();
    let state = started(original, ctx);
    expect(state.sessions[0]!.queue).toEqual(started(original, ctx).sessions[0]!.queue);
    expect(original.sessions).toHaveLength(0);
    const queue = state.sessions[0]!.queue;
    expect(queue).toHaveLength(8);
    expect(questionFor(state, queue[0]!).demand).toBe("recognize");
    for (const item of queue) {
      const question = questionFor(state, item);
      if (question.kind === "order") expect(item.displayIds).not.toEqual(question.correctTokenIds);
    }
    const input = responseFor(state, "session-1");
    state = transitionPassage(state, ctx, { type: "input", sessionId: "session-1", index: 0, response: input });
    expect(state.attempts).toHaveLength(0);
    state = decodePassageState(JSON.stringify(state));
    expect(state.sessions[0]!.input).toEqual(input);
    expect(transitionPassage(state, ctx, { type: "start", sessionId: "unused", seed: 99 })).toBe(state);
    state = transitionPassage(state, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "submission-1", response: input });
    const restored = decodePassageState(JSON.stringify(state));
    expect(restored.sessions[0]!.feedbackAttemptId).toBe("submission-1");
    expect(restored.sessions[0]!.queue).toEqual(queue);
    expect(restored.attempts[0]).toMatchObject({ correct: true, evidenceEligible: false });
    expect(transitionPassage(restored, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "submission-1", response: input })).toBe(restored);
    expect(() => transitionPassage(restored, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "another", response: input })).toThrow("已提交");
    expect(() => transitionPassage(restored, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "submission-1", response: { text: "", selectedIds: [] } })).toThrow("已用于");
  });
  it("finishes an all-wrong level with finite variant repair, records weakness separately, and advances the path", () => {
    const ctx = context();
    const state = finishSession(started(), ctx, "session-1", false);
    const session = state.sessions[0]!;
    expect(session.status).toBe("completed");
    expect(session.queue.length).toBeGreaterThan(8);
    expect(session.queue.length).toBeLessThanOrEqual(10);
    expect(new Set(session.queue.map(item => item.questionId)).size).toBe(session.queue.length);
    expect(session.queue.slice(session.baseCount).every(item => item.reason === "repair")).toBe(true);
    expect(state.attempts.every(attempt => !attempt.correct && !attempt.evidenceEligible)).toBe(true);
    expect(state.completions).toHaveLength(1);
    const report = passageReport(state, ctx.learnerId, ctx.courseId, "package-1");
    expect(report).toMatchObject({ completedLevels: 1, totalLevels: 2, firstAttemptCount: 8, firstCorrectCount: 0 });
    expect(report.goals[0]!.status).toBe("weak");
    expect(decodePassageState(JSON.stringify(state))).toEqual(state);
    const next = started(state, ctx, "session-2");
    expect(next.sessions[1]!.levelId).toBe("level-invite");
    const questions = next.sessions[1]!.queue.map(item => questionFor(next, item));
    expect(questions.find(question => question.goalId === "goal-invite")!.demand).toBe("recognize");
    expect(questions.some(question => question.goalId === "goal-like")).toBe(true);
  });
  it("keeps one Continue entry after path completion and permits only completed level replay", () => {
    const ctx = context();
    let state = started();
    expect(() => transitionPassage(state, { ...ctx, learnerId: "child-b" }, { type: "start", sessionId: "bad-replay", seed: 1, replayLevelId: "level-like" })).toThrow("已完成");
    state = finishSession(state, ctx, "session-1");
    state = finishSession(started(state, ctx, "session-2"), ctx, "session-2");
    state = started(state, ctx, "session-3");
    expect(state.sessions[2]).toMatchObject({ kind: "practice", levelId: null });
    state = finishSession(state, ctx, "session-3");
    state = transitionPassage(state, ctx, { type: "start", sessionId: "session-4", seed: 10, replayLevelId: "level-like" });
    expect(state.sessions[3]).toMatchObject({ kind: "replay", levelId: "level-like" });
    expect(state.completions).toHaveLength(2);
    expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
  });
  it("isolates children and courses and refuses stale submit/input/next commands", () => {
    const state = started();
    const ctx = context();
    const input = responseFor(state, "session-1");
    for (const changed of [{ ...ctx, learnerId: "child-b" }, { ...ctx, activeModeId: "seven-step" }])
      expect(() => transitionPassage(state, changed, { type: "submit", sessionId: "session-1", index: 0, attemptId: "bad", response: input })).toThrow();
    expect(() => transitionPassage(state, ctx, { type: "input", sessionId: "session-1", index: 1, response: input })).toThrow("位置");
    expect(() => transitionPassage(state, ctx, { type: "next", sessionId: "session-1", index: 0 })).toThrow("先提交");
    const other = started(state, { ...ctx, learnerId: "child-b" }, "other-child");
    expect(other.sessions).toHaveLength(2);
    expect(projectGoalProgress(other, "child-b", fixturePackage()).every(goal => !goal.seen)).toBe(true);
    let next = transitionPassage(state, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "ok", response: input });
    next = transitionPassage(next, ctx, { type: "next", sessionId: "session-1", index: 0 });
    expect(transitionPassage(next, ctx, { type: "next", sessionId: "session-1", index: 0 })).toBe(next);
  });
  it("requires spaced independent sessions, excludes the baseline, assistance, and a rolled-back clock", () => {
    const draft = fixtureDraft();
    draft.goals.forEach(goal => { goal.requiresRecall = false; goal.skill = "meaning"; });
    draft.questions = draft.questions.filter(question => question.kind !== "cloze" && question.kind !== "order");
    const pkg = fixturePackage(undefined, undefined, draft);
    let state = approve(emptyPassageState(), pkg);
    const run = (ctx: RuntimeContext, name: string, assisted = false) => {
      state = started(state, ctx, name);
      if (assisted) state = transitionPassage(state, ctx, { type: "assist", sessionId: name, index: 0 });
      state = finishSession(state, ctx, name);
    };
    run(context(), "baseline");
    expect(projectGoalProgress(state, "child-a", pkg)[0]!.independentSessions).toBe(0);
    run(context(undefined, undefined, "2026-10-18T10:00:00.000Z"), "second");
    expect(projectGoalProgress(state, "child-a", pkg)[0]!.independentSessions).toBe(1);
    run(context(undefined, undefined, "2026-10-19T10:00:00.000Z"), "assisted", true);
    expect(projectGoalProgress(state, "child-a", pkg)[0]!.independentSessions).toBe(1);
    run(context(undefined, undefined, "2026-10-17T10:00:00.000Z"), "rollback");
    expect(projectGoalProgress(state, "child-a", pkg)[0]!.independentSessions).toBe(1);
    expect(state.lastObservedAt).toBe("2026-10-19T10:00:00.000Z");
    run(context(undefined, undefined, "2026-10-20T10:00:00.000Z"), "third");
    run(context(undefined, undefined, "2026-10-21T10:00:00.000Z"), "fourth");
    expect(projectGoalProgress(state, "child-a", pkg)[0]).toMatchObject({ independentSessions: 3, status: "stable", dueAt: "2026-10-28T10:00:00.000Z" });
    expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
  });
  it("keeps an untrusted future clock out of due dates and independent evidence", () => {
    const ctx = context();
    let state = finishSession(started(), ctx, "session-1", false);
    const future = context(undefined, undefined, "2099-10-17T10:00:00.000Z"); future.clock.trusted = false;
    state = finishSession(started(state, future, "untrusted"), future, "untrusted", false);
    expect(state.lastObservedAt).toBe(ctx.clock.at);
    expect(state.attempts.filter(attempt => attempt.sessionId === "untrusted").every(attempt => !attempt.clockTrusted && !attempt.evidenceEligible)).toBe(true);
    expect(projectGoalProgress(state, "child-a", fixturePackage())[0]!.dueAt).toBe("2026-10-17T14:00:00.000Z");
    expect(decodePassageState(JSON.stringify(state))).toEqual(state);
  });
  it.each(["child", "course"])("preserves a partial cloze answer while changing %s and resuming", kind => {
    const ctx = context();
    let state = started();
    while (questionFor(state, state.sessions[0]!.queue[state.sessions[0]!.index]!).kind !== "cloze") {
      const index = state.sessions[0]!.index;
      state = transitionPassage(state, ctx, { type: "submit", sessionId: "session-1", index, attemptId: `partial-${index}`, response: responseFor(state, "session-1") });
      state = transitionPassage(state, ctx, { type: "next", sessionId: "session-1", index });
    }
    const index = state.sessions[0]!.index, count = state.attempts.length;
    state = transitionPassage(state, ctx, { type: "input", sessionId: "session-1", index, response: { text: "bas", selectedIds: [] } });
    const before = structuredClone(state.sessions[0]);
    const other = kind === "child" ? { ...ctx, learnerId: "child-b" } : context("course-other");
    if (kind === "course") state = approve(state, fixturePackage("course-other"));
    state = started(state, other, "other-session");
    state = decodePassageState(JSON.stringify(state));
    state = transitionPassage(state, ctx, { type: "start", sessionId: "unused", seed: 99 });
    expect(state.sessions[0]).toEqual(before);
    expect(state.sessions[0]!.input.text).toBe("bas");
    expect(state.attempts).toHaveLength(count);
  });
  it("preserves every new goal's coverage and bounds repairs across different deterministic seeds", () => {
    const draft = fixtureDraft();
    draft.levels = [{ id: "combined", title: "邀请朋友聊运动", newGoalIds: ["goal-like", "goal-invite"], reviewGoalIds: [] }];
    const pkg = fixturePackage(undefined, undefined, draft);
    const initial = approve(emptyPassageState(), pkg), ctx = context();
    const sequences = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      let state = started(initial, ctx, `seed-${seed}`, seed);
      const questions = state.sessions[0]!.queue.map(item => questionFor(state, item));
      for (const goal of pkg.goals) {
        const own = questions.filter(question => question.goalId === goal.id);
        expect(own[0]!.demand).toBe("recognize");
        expect(own.some(question => question.demand === "recall")).toBe(true);
      }
      sequences.add(JSON.stringify(state.sessions[0]!.queue));
      state = finishSession(state, ctx, `seed-${seed}`, false);
      expect(state.sessions[0]!.queue.length).toBeLessThanOrEqual(10);
      expect(state.completions).toHaveLength(1);
      expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
    }
    expect(sequences.size).toBeGreaterThan(1);
    expect(initial.sessions).toHaveLength(0);
  });
});

describe("passage-path approval, availability and review eligibility", () => {
  it("does not publish missing audio, mutate a revision, or lose history when adopting a new package", () => {
    const pkg = fixturePackage();
    expect(() => publishPassagePackage(emptyPassageState(), pkg, { reviewedAt: "2026-10-17T10:00:00.000Z", audioAssetIds: [] })).toThrow("音频");
    const state = started();
    const modified = structuredClone(pkg); modified.questions[0]!.explanation = "changed";
    expect(() => approve(state, modified)).toThrow("修订不能替换");
    const updated = approve(state, fixturePackage(undefined, "package-2"));
    expect(updated.sessions[0]!.status).toBe("retired");
    expect(updated.packages).toHaveLength(2);
    expect(updated.publications[0]!.revision).toBe("package-2");
    const resumed = started(updated, context(), "new-version");
    expect(resumed.sessions[1]).toMatchObject({ revision: "package-2", levelId: "level-like", baseline: true });
    expect(decodePassageState(JSON.stringify(resumed))).toEqual(resumed);
    expect(state.sessions[0]!.status).toBe("active");
  });
  it("blocks missing, archived and unavailable-audio content before start and submission", () => {
    const ctx = context();
    expect(() => started(emptyPassageState(), ctx)).toThrow("生成并审核");
    const state = started();
    for (const course of [{ courseId: ctx.courseId, available: false, audioReady: true }, { courseId: ctx.courseId, available: true, audioReady: false }]) {
      const blocked = { ...ctx, courses: [course] };
      expect(() => started(state, blocked, "blocked")).toThrow();
      expect(() => transitionPassage(state, blocked, { type: "submit", sessionId: "session-1", index: 0, attemptId: "bad", response: responseFor(state, "session-1") })).toThrow();
    }
  });
  it("mixes only learned goals of the same child and caps cross-course review, retiring mixed queues on adoption", () => {
    const oldCourse = fixturePackage("course-previous");
    let state = approve(approve(), oldCourse);
    state = finishSession(started(state, context(oldCourse.courseId), "previous"), context(oldCourse.courseId), "previous", false);
    const ctx = context(undefined, undefined, "2026-10-19T10:00:00.000Z");
    ctx.courses.push({ courseId: oldCourse.courseId, available: true, audioReady: true });
    state = started(state, ctx, "mixed");
    const cross = state.sessions.find(session => session.id === "mixed")!.queue.filter(item => item.courseId !== ctx.courseId);
    expect(cross.length).toBeGreaterThan(0);
    expect(cross.length).toBeLessThanOrEqual(2);
    expect(cross.every(item => questionFor(state, item).goalId === "goal-like")).toBe(true);
    const otherChild = started(state, { ...ctx, learnerId: "child-b" }, "other-child");
    expect(otherChild.sessions.at(-1)!.queue.every(item => item.courseId === ctx.courseId)).toBe(true);
    const archivedContext = { ...ctx, courses: ctx.courses.map(course => ({ ...course, available: course.courseId !== oldCourse.courseId })) };
    expect(() => started(state, archivedContext, "resume-mixed")).toThrow("归档");
    const revised = approve(state, fixturePackage(oldCourse.courseId, "package-2"));
    expect(revised.sessions.find(session => session.id === "mixed")!.status).toBe("retired");
    expect(revised.attempts).toEqual(state.attempts);
    expect(() => decodePassageState(JSON.stringify(revised))).not.toThrow();
  });
});

describe("passage-path snapshot guards", () => {
  it("rejects changed historical grades and unsupported evidence eligibility", () => {
    const state = started(), ctx = context();
    const submitted = transitionPassage(state, ctx, { type: "submit", sessionId: "session-1", index: 0, attemptId: "one", response: responseFor(state, "session-1") });
    const changedGrade = structuredClone(submitted); changedGrade.attempts[0]!.correct = false;
    expect(() => decodePassageState(JSON.stringify(changedGrade))).toThrow("评价");
    const changedEvidence = structuredClone(submitted); changedEvidence.attempts[0]!.evidenceEligible = true;
    expect(() => decodePassageState(JSON.stringify(changedEvidence))).toThrow("评价");
  });
  it.each([
    ["unsupported version", (state: PassageState) => { (state as { formatVersion: number }).formatVersion = 99; }],
    ["unknown question", (state: PassageState) => { state.sessions[0]!.queue[0]!.questionId = "missing"; }],
    ["foreign display option", (state: PassageState) => { state.sessions[0]!.queue[0]!.displayIds = ["missing"]; }],
    ["invalid position", (state: PassageState) => { state.sessions[0]!.index = 1; }],
    ["invalid source package", (state: PassageState) => { state.packages[0]!.runtimeVersion = "99" as "1"; }],
    ["false completion", (state: PassageState) => { state.completions.push({ learnerId: "child-a", courseId: context().courseId, revision: "package-1", levelId: "level-like", sessionId: "session-1" }); }],
    ["unprepared publication", (state: PassageState) => { state.publications[0]!.audioAssetIds = []; }],
  ] as const)("rejects %s without producing an empty fallback", (_, mutate) => {
    const state = started(); mutate(state);
    expect(() => decodePassageState(JSON.stringify(state))).toThrow("课文闯关");
  });
});
