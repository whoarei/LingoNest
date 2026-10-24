import { describe, expect, it } from "vitest";
import { approve, context, finishSession, fixtureCurriculumDraft, fixtureCurriculumPackage, fixtureSource, responseFor, started } from "./fixtures/passage-path";
import { transitionPassage } from "../packages/learning-modes/passage-path/runtime";
import { decodePassageState } from "../packages/learning-modes/passage-path/state";
import { compilePassagePackage, validateDraft } from "../packages/learning-modes/passage-path/authoring";
import { completedLessons, lessonQuestion } from "../packages/learning-modes/passage-path/curriculum";
import { questionFor } from "../packages/learning-modes/passage-path/references";
import { roundSummary, reviewSuggestion } from "../packages/learning-modes/passage-path/summary";
import { removePassageCourse, removePassageLearner } from "../packages/learning-modes/passage-path/deletion";
import { passageDeletionParticipant } from "../src/modes/passage-path/services";
import type { SharedSnapshot } from "../src/platform/shared-snapshot";
import type { PassageState } from "../packages/learning-modes/passage-path/model";

describe("multi-lesson passage curriculum", () => {
  it("preserves two-goal coverage and the short-lesson budget across deterministic seeds", () => {
    const draft = fixtureCurriculumDraft(); draft.levels = [{ id: "combined", title: "一起参加活动", newGoalIds: draft.goals.map(goal => goal.id), reviewGoalIds: [] }];
    const pkg = compilePassagePackage({ source: fixtureSource(), draft, modeInstanceId: "combined", revision: "combined-1", model: "test", generatedAt: context().clock.at });
    for (let seed = 0; seed < 20; seed++) {
      let state = approve(undefined, pkg);
      for (const lesson of ["discover", "transfer", "communicate"]) {
        const id = `${lesson}-${seed}`; state = started(state, context(), id, seed);
        const run = state.sessions.at(-1)!, questions = run.queue.map(item => questionFor(state, item));
        expect(run.baseCount).toBeLessThanOrEqual(6); expect(run.baseCount).toBeGreaterThanOrEqual(4);
        for (const goal of pkg.goals) {
          expect(questions.some(question => question.goalId === goal.id)).toBe(true);
          if (lesson === "communicate") for (const kind of ["listen-choice", "speak"]) expect(questions.some(question => question.goalId === goal.id && question.kind === kind)).toBe(true);
        }
        state = finishSession(state, context(), id);
      }
      expect(state.completions).toHaveLength(1); expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
    }
  });
  it("requires three short lessons before completing a level and resumes the exact current lesson", () => {
    const pkg = fixtureCurriculumPackage(), ctx = context(); let state = approve(undefined, pkg);
    for (const [index, lesson] of ["discover", "transfer", "communicate"].entries()) {
      const id = `lesson-${index}`; state = started(state, ctx, id);
      expect(state.sessions.at(-1)!.lesson).toBe(lesson);
      const frozen = decodePassageState(JSON.stringify(state)); expect(started(frozen, ctx)).toBe(frozen);
      state = finishSession(state, ctx, id);
      expect(state.completions).toHaveLength(index === 2 ? 1 : 0);
      expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
    }
    expect(completedLessons(state, ctx.learnerId, pkg, pkg.levels[0]!.id)).toHaveLength(3);
    expect(state.attempts.filter(attempt => attempt.correct === null).every(attempt => !attempt.evidenceEligible)).toBe(true);
    const next = started(state, ctx, "next-level"); expect(next.sessions.at(-1)).toMatchObject({ levelId: "level-invite", lesson: "discover" });
  });
  it("enforces transfer context and a listening plus speaking opportunity for each target", () => {
    const pkg = fixtureCurriculumPackage(), ctx = context(); let state = finishSession(started(approve(undefined, pkg), ctx), ctx, "session-1");
    state = started(state, ctx, "transfer");
    expect(state.sessions.at(-1)!.queue.slice(0, state.sessions.at(-1)!.baseCount).every(item => !!questionFor(state, item).context)).toBe(true);
    state = finishSession(state, ctx, "transfer"); state = started(state, ctx, "communication");
    const kinds = state.sessions.at(-1)!.queue.map(item => questionFor(state, item).kind);
    expect(kinds).toContain("listen-choice"); expect(kinds).toContain("speak");
    expect(() => transitionPassage(state, { ...ctx, learnerId: "child-b" }, { type: "start", sessionId: "skip", seed: 1, replayLevelId: "level-like", replayLesson: "transfer" })).toThrow("已完成");
  });
  it("rejects candidate banks that cannot deliver an actual transfer or speaking lesson", () => {
    for (const kind of ["context", "oral", "listening"]) {
      const draft = fixtureCurriculumDraft();
      draft.questions = draft.questions.filter(question => kind === "context" ? !question.context : kind === "oral" ? question.kind !== "speak" : question.kind !== "listen-choice");
      expect(() => validateDraft(draft, fixtureSource())).toThrow();
    }
  });
  it("keeps overdue own-course reviews in the current short lesson's question bank", () => {
    const draft = fixtureCurriculumDraft(); draft.levels[1]!.reviewGoalIds = [];
    const pkg = compilePassagePackage({ source: fixtureSource(), draft, modeInstanceId: "phase-review", revision: "phase-review-1", model: "test", generatedAt: context().clock.at });
    const ctx = context(); let state = approve(undefined, pkg);
    for (const id of ["discover", "transfer", "communicate"]) state = finishSession(started(state, ctx, id), ctx, id);
    state = transitionPassage(state, ctx, { type: "start", sessionId: "discovery-replay", seed: 7, replayLevelId: pkg.levels[0]!.id, replayLesson: "discover" });
    state = finishSession(state, ctx, "discovery-replay");
    const later = { ...ctx, clock: { at: "2026-10-20T11:00:00.000Z", trusted: true } };
    for (let seed = 0; seed < 20; seed++) {
      const next = started(state, later, `later-${seed}`, seed), run = next.sessions.at(-1)!;
      expect(run.queue.every(item => lessonQuestion(questionFor(next, item), "discover"))).toBe(true);
      expect(() => decodePassageState(JSON.stringify(next))).not.toThrow();
    }
  });
  it("keeps oral self assessment separate from correctness and recommends a useful next step", () => {
    const pkg = fixtureCurriculumPackage(), ctx = context(); let state = approve(undefined, pkg);
    for (const id of ["discover", "transfer"]) state = finishSession(started(state, ctx, id), ctx, id);
    state = started(state, ctx, "oral");
    while (questionFor(state, state.sessions.at(-1)!.queue[state.sessions.at(-1)!.index]!).kind !== "speak") {
      const run = state.sessions.at(-1)!;
      state = transitionPassage(state, ctx, { type: "submit", sessionId: run.id, index: run.index, attemptId: `written-${run.index}`, response: responseFor(state, run.id) });
      state = transitionPassage(state, ctx, { type: "next", sessionId: run.id, index: run.index });
    }
    const run = state.sessions.at(-1)!, command = { type: "submit" as const, sessionId: run.id, index: run.index, attemptId: "oral-attempt" };
    expect(() => transitionPassage(state, ctx, { ...command, response: { text: "", selectedIds: [] } })).toThrow("完整回听");
    expect(() => transitionPassage(state, ctx, { ...command, response: { text: "", selectedIds: [], oral: { recordingPath: "recordings/child-b/test.m4a", listened: true, selfRating: "ready" } } })).toThrow("当前孩子");
    state = transitionPassage(state, ctx, { ...command, response: responseFor(state, run.id, false) });
    expect(state.attempts.at(-1)).toMatchObject({ correct: null, evidenceEligible: false });
    expect(roundSummary(state, state.sessions.at(-1)!).needsPractice).toHaveLength(1);
    const tomorrow = "2026-10-19T10:00:00.000Z";
    expect(reviewSuggestion(state, "child-b", pkg, tomorrow)).toBeNull();
    expect(reviewSuggestion(state, ctx.learnerId, pkg, tomorrow)?.lesson).toBe("transfer");
  });

  it("keeps all recorded takes owned by their child and cleans a course without removing another course's recordings", async () => {
    const first = fixtureCurriculumPackage("course-a"), second = fixtureCurriculumPackage("course-b");
    let state = approve(approve(undefined, first), second);
    for (const pkg of [first, second]) for (const learner of ["child-a", "child-b"]) {
      const ctx = context(pkg.courseId, learner);
      for (let index = 0; index < 3; index++) {
        const id = `${pkg.courseId}-${learner}-${index}`;
        state = finishSession(started(state, ctx, id), ctx, id);
      }
    }
    const source = { refresh: async () => state } as unknown as SharedSnapshot<PassageState>;
    const participant = passageDeletionParticipant(source);
    const resources = await participant.prepare({ kind: "learner", id: "child-a" });
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.every(resource => resource.kind === "recording" && resource.path.startsWith("recordings/child-a/"))).toBe(true);
    const beforeOther = state.sessions.filter(session => session.courseId === second.courseId);
    const owned = (await participant.prepare({ kind: "course", id: first.courseId })).flatMap(resource => resource.kind === "recording" ? [resource.path] : []);
    const removed = removePassageCourse(state, first.courseId);
    expect(owned.length).toBeGreaterThan(0);
    expect(beforeOther.flatMap(session => session.recordingPaths ?? []).some(path => owned.includes(path))).toBe(false);
    expect(removed.sessions).toEqual(beforeOther);
    expect(() => decodePassageState(JSON.stringify(removed))).not.toThrow();
    expect(removePassageLearner(state, "child-a").sessions).toEqual(state.sessions.filter(session => session.learnerId === "child-b"));
  });

  it("requires a completed listening playback and rejects a forged foreign recording in a restored draft", () => {
    let state = approve(undefined, fixtureCurriculumPackage()); const ctx = context();
    for (const id of ["intro", "transfer"]) state = finishSession(started(state, ctx, id), ctx, id);
    state = started(state, ctx, "communication");
    const run = state.sessions.at(-1)!;
    const listenIndex = run.queue.findIndex(item => questionFor(state, item).kind === "listen-choice");
    while (state.sessions.at(-1)!.index < listenIndex) {
      const active = state.sessions.at(-1)!;
      state = transitionPassage(state, ctx, { type: "submit", sessionId: active.id, index: active.index, attemptId: `a-${active.index}`, response: responseFor(state, active.id) });
      state = transitionPassage(state, ctx, { type: "next", sessionId: active.id, index: active.index });
    }
    const response = responseFor(state, run.id); delete response.audioPlayed;
    expect(() => transitionPassage(state, ctx, { type: "submit", sessionId: run.id, index: listenIndex, attemptId: "unheard", response })).toThrow("完整播放");
    const forged = structuredClone(state); forged.sessions.at(-1)!.input = { text: "", selectedIds: [], oral: { recordingPath: "recordings/child-b/take.m4a" } };
    expect(() => decodePassageState(JSON.stringify(forged))).toThrow();
  });
});
