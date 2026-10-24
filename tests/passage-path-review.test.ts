import { beforeEach, describe, expect, it } from "vitest";
import { setupCatalog, materialInput, materialPackage } from "./fixtures/shared-catalog";
import { makePassageAudioManifest } from "../packages/learning-modes/passage-path/authoring";
import { passagePathStateCodec } from "../packages/learning-modes/passage-path/state";
import type { PassageReview } from "../packages/learning-modes/passage-path/model";
import legacy from "./fixtures/seven-step-legacy.json";
import { reviseQuestion, reviseOutline } from "../packages/learning-modes/passage-path/review";

let setup: ReturnType<typeof setupCatalog>;
beforeEach(() => { setup = setupCatalog(); });
async function candidate(revision = "candidate-one") {
  const services = setup.services;
  await services.catalog.read();
  const id = await services.catalog.createMaterial(materialInput());
  const pkg = await materialPackage(services, id, revision);
  const review: PassageReview = { package: pkg, sourceConfirmed: true, reviewedQuestionIds: pkg.questions.map(item => item.id) };
  await services.passage.saveReview(review);
  return { services, id, review };
}
describe("parent candidate audit and independent publication", () => {
  it("edits a single candidate question without changing old publication, attempts or other audit decisions", async () => {
    const { services, id, review } = await candidate();
    await services.passage.publishCandidate(id, review.package.revision, async () => true);
    const before = structuredClone(services.passage.state.snapshot());
    const question = review.package.questions[0]!;
    const revised = reviseQuestion(review, { ...question, explanation: "家长修订后的答案说明。" }, "edited-question");
    expect(revised.reviewedQuestionIds).toEqual(review.reviewedQuestionIds.filter(item => item !== question.id));
    expect(revised.sourceConfirmed).toBe(true);
    await services.passage.saveReview(revised);
    expect(services.passage.state.snapshot().packages).toEqual(before.packages);
    expect(services.passage.state.snapshot().publications).toEqual(before.publications);
    expect(review.package.questions[0]!.explanation).toBe(question.explanation);
    await expect(services.passage.publishCandidate(id, "edited-question", async () => true)).rejects.toThrow("逐题审核");
    expect(() => reviseQuestion(review, { ...question, sourceTurnIds: ["missing"] }, "invalid-question")).toThrow();
  });
  it("invalidates only the changed outline's related questions and requires source confirmation again", async () => {
    const { review } = await candidate();
    const outline = structuredClone(review.package);
    outline.chunks[0]!.meaning = "修订后的意义说明";
    const revised = reviseOutline(review, outline, "edited-outline");
    const changedGoals = review.package.goals.filter(goal => goal.chunkId === outline.chunks[0]!.id).map(goal => goal.id);
    expect(revised.sourceConfirmed).toBe(false);
    expect(revised.reviewedQuestionIds).toEqual(review.package.questions.filter(question => !changedGoals.includes(question.goalId)).map(question => question.id));
    expect(review.sourceConfirmed).toBe(true);
  });
  it("requires every candidate question, original confirmation and actual complete audio", async () => {
    const { services, id, review } = await candidate();
    review.reviewedQuestionIds.pop(); await services.passage.saveReview(review);
    await expect(services.passage.publishCandidate(id, review.package.revision, async () => true)).rejects.toThrow("逐题审核");
    review.reviewedQuestionIds = review.package.questions.map(item => item.id); review.sourceConfirmed = false;
    await services.passage.saveReview(review);
    await expect(services.passage.publishCandidate(id, review.package.revision, async () => true)).rejects.toThrow("逐题审核");
    review.sourceConfirmed = true; await services.passage.saveReview(review);
    await expect(services.passage.publishCandidate(id, review.package.revision, async () => false)).rejects.toThrow("音频");
    expect(services.passage.state.snapshot().publications).toEqual([]);
    await services.passage.publishCandidate(id, review.package.revision, async () => true);
    expect(services.passage.state.snapshot().publications[0]!.audioAssetIds).toEqual(makePassageAudioManifest(review.package).assets.map(item => item.id));
  });
  it("publishes a managed course independently of the child's current selection and preserves all seven-step teaching facts", async () => {
    const { services, id, review } = await candidate();
    const old = services.sevenStep.state.snapshot();
    expect(services.catalog.selection().learningCourseIds["legacy-a"]).not.toBe(id);
    await services.passage.publishCandidate(id, review.package.revision, async () => true);
    expect(services.sevenStep.state.snapshot()).toEqual(old);
    expect(old.events).toEqual(legacy.snapshot.events);
    expect(old.runs).toEqual(legacy.snapshot.runs);
  });
  it("retains the old publication during regeneration and only adopts explicitly reviewed new versions", async () => {
    const { services, id, review } = await candidate();
    await services.passage.publishCandidate(id, review.package.revision, async () => true);
    const next: PassageReview = { ...review, package: { ...review.package, revision: "candidate-two" }, reviewedQuestionIds: [] };
    await services.passage.saveReview(next);
    expect(services.passage.state.snapshot().publications[0]!.revision).toBe("candidate-one");
    expect(passagePathStateCodec.decode(JSON.stringify(services.passage.state.snapshot())).candidates).toHaveLength(2);
    next.reviewedQuestionIds = next.package.questions.map(item => item.id); await services.passage.saveReview(next);
    await services.passage.publishCandidate(id, next.package.revision, async () => true);
    expect(services.passage.state.snapshot().packages.map(item => item.revision)).toEqual(["candidate-one", "candidate-two"]);
  });
  it("does not accept late results after source edits, disposal or deletion", async () => {
    const { services, id, review } = await candidate();
    await expect(services.passage.saveReview(review, () => false)).rejects.toThrow("已离开");
    await services.catalog.updateMaterial(id, { ...materialInput(), sourceText: "Hello.\nGood morning." });
    await expect(services.passage.saveReview(review)).rejects.toThrow("教材已变化");
    await expect(services.passage.publishCandidate(id, review.package.revision, async () => true)).rejects.toThrow("教材已变化");
    await services.catalog.archiveCourse(id); await services.catalog.purgeCourse(id);
    await expect(services.passage.saveReview(review)).rejects.toThrow();
    expect(services.passage.state.snapshot().candidates).toEqual([]);
    expect(setup.cleanup).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio", course: makePassageAudioManifest(review.package) }));
  });
  it("retains the last durable candidate and review checklist when saving fails", async () => {
    const { services, review } = await candidate();
    const before = services.passage.state.snapshot();
    setup.control.failWrite = key => key === passagePathStateCodec.storageKey;
    await expect(services.passage.saveReview({ ...review, reviewedQuestionIds: [] })).rejects.toThrow();
    expect(services.passage.state.snapshot()).toEqual(before);
    expect(passagePathStateCodec.decode(JSON.parse(setup.values.get(passagePathStateCodec.storageKey)!).payload)).toEqual(before);
  });
});
