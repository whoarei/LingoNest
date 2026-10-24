import type { PassageQuestion, PassageReview, PassageDraft, PassageSource } from "./model";
import { validatePackage } from "./authoring";
import { copy, requireValid } from "./validation";

/** Old source candidates remain stored for history/cleanup, but cannot resume editing. */
export function latestReviewForSource(reviews: readonly PassageReview[], source: PassageSource): PassageReview | null {
  const matching = reviews.filter(review => review.package.courseId === source.courseId && JSON.stringify(review.package.source) === JSON.stringify(source));
  return matching.length ? copy(matching[matching.length - 1]!) : null;
}

/** Candidate contents are immutable too: each edit creates a separate revision. */
export function reviseQuestion(review: PassageReview, question: PassageQuestion, revision: string): PassageReview {
  const index = review.package.questions.findIndex(item => item.id === question.id);
  requireValid(index >= 0 && revision !== review.package.revision, "待修改题目或新修订无效。");
  const next = copy(review);
  next.package.revision = revision;
  next.package.questions[index] = copy(question);
  validatePackage(next.package);
  next.reviewedQuestionIds = next.reviewedQuestionIds.filter(id => id !== question.id);
  if (next.returnedQuestionIds) next.returnedQuestionIds = next.returnedQuestionIds.filter(id => id !== question.id);
  return next;
}

export type PassageOutline = Pick<PassageDraft, "chunks" | "goals" | "levels">;
export function reviseOutline(review: PassageReview, outline: PassageOutline, revision: string): PassageReview {
  requireValid(revision !== review.package.revision, "请为内容修改建立新修订。");
  const changedChunks = new Set(outline.chunks.filter(chunk => JSON.stringify(chunk) !== JSON.stringify(review.package.chunks.find(item => item.id === chunk.id))).map(chunk => chunk.id));
  const changedGoals = new Set(outline.goals.filter(goal => changedChunks.has(goal.chunkId) || JSON.stringify(goal) !== JSON.stringify(review.package.goals.find(item => item.id === goal.id))).map(goal => goal.id));
  const next = copy(review);
  Object.assign(next.package, copy(outline), { revision });
  validatePackage(next.package);
  next.sourceConfirmed = false;
  next.reviewedQuestionIds = next.reviewedQuestionIds.filter(id => !changedGoals.has(next.package.questions.find(question => question.id === id)!.goalId));
  return next;
}
