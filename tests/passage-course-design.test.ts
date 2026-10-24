import { describe, expect, it } from "vitest";
import { approve, context, finishSession, fixtureDraft, fixturePackage, responseFor, started } from "./fixtures/passage-path";
import { transitionPassage } from "../packages/learning-modes/passage-path/runtime";
import { questionFor } from "../packages/learning-modes/passage-path/references";
import { projectGoalProgress } from "../packages/learning-modes/passage-path/progress";
import { decodePassageState } from "../packages/learning-modes/passage-path/state";

describe("passage course progression", () => {
  it.each([1, 2])("scaffolds each of %i new goals from recognition through assembly to recall across seeds", count => {
    const draft = fixtureDraft();
    if (count === 2) draft.levels = [{ id: "combined", title: "交流表达", newGoalIds: draft.goals.map(goal => goal.id), reviewGoalIds: [] }];
    const baseline = approve(undefined, fixturePackage(undefined, undefined, draft));
    for (let seed = 0; seed < 40; seed++) {
      const state = started(baseline, context(), `seed-${seed}`, seed);
      for (const goalId of draft.levels[0]!.newGoalIds) {
        const demands = state.sessions[0]!.queue.map(item => questionFor(state, item)).filter(question => question.goalId === goalId).map(question => question.demand);
        expect(demands.indexOf("supported"), `seed ${seed}, ${goalId}`).toBeGreaterThan(demands.indexOf("recognize"));
        expect(demands.indexOf("recall"), `seed ${seed}, ${goalId}`).toBeGreaterThan(demands.indexOf("supported"));
      }
    }
  });

  it("treats a completed level replay as review and allows spaced independent recall evidence", () => {
    const first = finishSession(started(), context(), "session-1");
    const later = context(undefined, undefined, "2026-10-18T10:00:00.000Z");
    const state = transitionPassage(first, later, { type: "start", sessionId: "replay", seed: 7, replayLevelId: "level-like" });
    const run = state.sessions[1]!;
    expect(questionFor(state, run.queue[0]!).demand).toBe("recall");
    const completed = finishSession(state, later, "replay");
    expect(projectGoalProgress(completed, later.learnerId, fixturePackage())[0]!.independentSessions).toBe(1);
    expect(completed.completions).toEqual(first.completions);
    expect(() => decodePassageState(JSON.stringify(completed))).not.toThrow();
  });

  it("prefers unused variants within the same demand while keeping other children's choices unchanged", () => {
    const first = finishSession(started(), context(), "session-1");
    const priorRecall = first.attempts.find(attempt => questionFor(first, attempt.item).demand === "recall")!.item.questionId;
    const later = context(undefined, undefined, "2026-10-18T10:00:00.000Z");
    for (let seed = 0; seed < 40; seed++) {
      const state = started(first, later, `seed-${seed}`, seed);
      const item = state.sessions[1]!.queue.find(item => questionFor(state, item).goalId === "goal-like")!;
      expect(questionFor(state, item).demand).toBe("recall");
      expect(item.questionId, `seed ${seed}`).not.toBe(priorRecall);
    }
    const child = context(undefined, "child-b"), fresh = started(approve(), child, "fresh", 13), withHistory = started(first, child, "fresh", 13);
    expect(withHistory.sessions.at(-1)!.queue).toEqual(fresh.sessions[0]!.queue);
  });

  it("keeps scaffolding for an unseen goal while reviewing the seen goal after a partial round is retired", () => {
    const draft = fixtureDraft(); draft.levels = [{ id: "combined", title: "交流表达", newGoalIds: draft.goals.map(goal => goal.id), reviewGoalIds: [] }];
    let state = started(approve(undefined, fixturePackage(undefined, undefined, draft)));
    const seen = questionFor(state, state.sessions[0]!.queue[0]!).goalId;
    state = transitionPassage(state, context(), { type: "submit", sessionId: "session-1", index: 0, attemptId: "partial", response: responseFor(state, "session-1") });
    state.sessions[0]!.status = "retired";
    state = started(decodePassageState(JSON.stringify(state)), context(), "new-round");
    const questions = state.sessions[1]!.queue.map(item => questionFor(state, item));
    expect(questions.find(question => question.goalId === seen)!.demand).toBe("recall");
    const newGoal = questions.filter(question => question.goalId !== seen).map(question => question.demand);
    expect(newGoal).toEqual(["recognize", "supported", "recall"]);
    expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
  });

  it("rotates back to the least recently practiced recall once all variants have been used", () => {
    let state = finishSession(started(), context(), "session-1");
    const later = context(undefined, undefined, "2026-10-18T10:00:00.000Z");
    state = transitionPassage(state, later, { type: "start", sessionId: "replay-1", seed: 7, replayLevelId: "level-like" });
    state = finishSession(state, later, "replay-1");
    const pkg = fixturePackage(), recalls = pkg.questions.filter(question => question.goalId === "goal-like" && question.demand === "recall");
    const last = (id: string) => state.attempts.reduce((last, attempt, index) => attempt.item.questionId === id ? index : last, -1);
    expect(recalls.every(question => last(question.id) >= 0)).toBe(true);
    const expected = [...recalls].sort((a, b) => last(a.id) - last(b.id))[0]!.id;
    const ctx = context(undefined, undefined, "2026-10-19T10:00:00.000Z");
    for (let seed = 0; seed < 10; seed++) {
      const command = { type: "start" as const, sessionId: "replay-2", seed, replayLevelId: "level-like" };
      const next = transitionPassage(state, ctx, command);
      expect(next.sessions.at(-1)!.queue[0]!.questionId).toBe(expected);
      const rollback = transitionPassage(state, context(undefined, undefined, "2026-10-16T10:00:00.000Z"), command);
      expect(rollback.sessions.at(-1)!.queue).toEqual(next.sessions.at(-1)!.queue);
    }
  });
});
