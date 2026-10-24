import { describe, expect, it } from "vitest";
import { approve, context, finishSession, fixtureDraft, fixturePackage, fixtureSource, started } from "./fixtures/passage-path";
import { transitionPassage } from "../packages/learning-modes/passage-path/runtime";
import { questionFor } from "../packages/learning-modes/passage-path/references";
import { projectGoalProgress } from "../packages/learning-modes/passage-path/progress";
import { randomFromSeed, sessionItem } from "../packages/learning-modes/passage-path/scheduler";
import { decodePassageState } from "../packages/learning-modes/passage-path/state";
import { latestReviewForSource } from "../packages/learning-modes/passage-path/review";
import { learningAudioPackages } from "../src/modes/passage-path/learning-audio";
import type { CatalogSnapshot } from "../packages/learning-modes/catalog";

describe("passage learning review", () => {
  it("does not treat a hint for one goal as help for the rest of the round", () => {
    const draft = fixtureDraft(); draft.levels = [{ id: "combined", title: "交流表达", newGoalIds: draft.goals.map(goal => goal.id), reviewGoalIds: [] }];
    let state = started(approve(undefined, fixturePackage(undefined, undefined, draft)));
    const goalId = questionFor(state, state.sessions[0]!.queue[0]!).goalId;
    state = transitionPassage(state, context(), { type: "assist", sessionId: "session-1", index: 0, kind: "hint" });
    expect(state.sessions[0]!.assistedGoals.map(goal => goal.goalId)).toEqual([goalId]);
  });
  it.each(["hint", "source"] as const)("does not mark another course as exposed when opening %s", kind => {
    const old = fixturePackage("course-other"), ctx = context(); ctx.courses.push({ courseId: old.courseId, available: true, audioReady: true });
    let state = started(approve(approve(), old), ctx);
    state.sessions[0]!.queue.push(sessionItem(old, old.questions[0]!, "due", randomFromSeed(2))); state.sessions[0]!.baseCount++;
    state = transitionPassage(state, ctx, { type: "assist", sessionId: "session-1", index: 0, kind });
    expect(state.sessions[0]!.assistedGoals.every(goal => goal.courseId === ctx.courseId)).toBe(true);
    expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
  });

  it("records the displayed whole-course source even when the paused question belongs to another course", () => {
    const old = fixturePackage("course-other"), ctx = context(); ctx.courses.push({ courseId: old.courseId, available: true, audioReady: true });
    let state = started(approve(approve(), old), ctx);
    state.sessions[0]!.queue.unshift(sessionItem(old, old.questions[0]!, "due", randomFromSeed(2))); state.sessions[0]!.baseCount++;
    const source = { courseId: ctx.courseId, revision: "package-1" };
    state = transitionPassage(state, ctx, { type: "assist", sessionId: "session-1", index: 0, kind: "source", source });
    expect(state.sessions[0]!.assistedGoals.every(goal => goal.courseId === ctx.courseId)).toBe(true);
    expect(state.sessions[0]!.helpRequests).toEqual([{ ...source, questionId: null, kind: "source" }]);
    expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
    expect(() => transitionPassage(state, ctx, { type: "assist", sessionId: "session-1", index: 0, kind: "hint", source })).toThrow("原文不属于当前会话");
    expect(() => transitionPassage(state, ctx, { type: "assist", sessionId: "session-1", index: 0, kind: "source", source: { ...source, courseId: "unrelated" } })).toThrow("原文不属于当前会话");
  });

  it.each(["2", "3"] as const)("retains frozen version-%s queues and uses the new scheduling policy only for a new round", version => {
    const state = started(); state.sessions[0]!.schedulerVersion = version;
    const restored = decodePassageState(JSON.stringify(state));
    expect(started(restored)).toBe(restored); expect(restored.sessions[0]!.queue).toEqual(state.sessions[0]!.queue);
    const next = started(restored, context(undefined, "child-b"), "new-policy");
    expect(next.sessions[1]!.schedulerVersion).toBe("5");
  });

  it("uses recall before showing answers for a previously learned goal across seeds", () => {
    const pkg = fixturePackage(), first = context();
    const baseline = finishSession(started(), first, "session-1");
    const later = context(undefined, undefined, "2026-10-19T10:00:00.000Z");
    for (let seed = 0; seed < 30; seed++) {
      const state = started(baseline, later, `later-${seed}`, seed);
      const review = state.sessions[1]!.queue.map(item => questionFor(state, item)).filter(question => question.goalId === "goal-like");
      expect(review[0]!.demand, `seed ${seed}`).toBe("recall");
      expect(state.sessions[1]!.queue.length).toBeLessThanOrEqual(pkg.rules.questionCount);
    }
  });

  it("allows default recall goals to accumulate spaced independent evidence without depending on random item order", () => {
    const pkg = fixturePackage(); let state = finishSession(started(), context(), "session-1");
    for (let day = 18; day <= 21; day++) {
      const ctx = context(undefined, undefined, `2026-10-${day}T10:00:00.000Z`);
      const id = `day-${day}`; state = finishSession(started(state, ctx, id, day), ctx, id);
    }
    expect(projectGoalProgress(state, "child-a", pkg).find(goal => goal.goalId === "goal-like")).toMatchObject({ independentSessions: 4, status: "stable" });
    expect(() => decodePassageState(JSON.stringify(state))).not.toThrow();
  });

  it("does not resume candidates after either the source revision or its full content changes", () => {
    const source = fixtureSource(), review = { package: fixturePackage(), sourceConfirmed: true, reviewedQuestionIds: ["question-like-0"] };
    const matching = latestReviewForSource([review], source)!; matching.reviewedQuestionIds.length = 0;
    expect(review.reviewedQuestionIds).toEqual(["question-like-0"]);
    expect(latestReviewForSource([review], { ...source, revision: "source-2" })).toBeNull();
    expect(latestReviewForSource([review], { ...source, turns: source.turns.map((turn, index) => index ? turn : { ...turn, text: "Changed source." }) })).toBeNull();
  });

  it("checks audio only for the current child and available, previously practiced publications", () => {
    const own = fixturePackage(), old = fixturePackage("review-course"), other = fixturePackage("other-child-course"), archived = fixturePackage("archived-course"), unseen = fixturePackage("unseen-course");
    old.questions.forEach(question => { question.prompt += "（旧课复习）"; });
    let state = approve(approve(approve(approve(approve(undefined, own), old), other), archived), unseen);
    state = finishSession(started(state, context(old.courseId), "old"), context(old.courseId), "old", false);
    state = finishSession(started(state, context(other.courseId, "child-b"), "other"), context(other.courseId, "child-b"), "other");
    state = finishSession(started(state, context(archived.courseId), "archived"), context(archived.courseId), "archived");
    const catalog: CatalogSnapshot = { learners: [], activeLearnerId: "child-a", defaultCourseId: own.courseId, learningCourseIds: {},
      courses: [own, old, other, archived, unseen].map(pkg => ({ id: pkg.courseId, title: pkg.source.title, subtitle: "", sourceText: "", images: [], supplementImages: [],
        sourceRevision: "source-1", builtin: false, archivedAt: pkg === archived ? "2026-10-17T10:00:00.000Z" : null })) };
    expect(learningAudioPackages(state, catalog, own.courseId).map(pkg => pkg.courseId)).toEqual([own.courseId, old.courseId]);
    const ctx = context(); ctx.courses.push({ courseId: old.courseId, available: true, audioReady: true });
    state = started(state, ctx);
    expect(state.sessions.at(-1)!.queue.some(item => item.courseId === old.courseId)).toBe(true);
    expect(learningAudioPackages(state, catalog, own.courseId).map(pkg => pkg.courseId)).toEqual([own.courseId, old.courseId]);
    state.sessions.at(-1)!.queue = state.sessions.at(-1)!.queue.filter(item => item.courseId === own.courseId);
    expect(learningAudioPackages(state, catalog, own.courseId).map(pkg => pkg.courseId)).toEqual([own.courseId]);
  });
});
