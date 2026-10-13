import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { course, exercises, sentences, stageDefinitions } from "../src/course";
import {
  cellKey,
  gradeExercise,
  projectLearning,
} from "../packages/learning-engine/src";
import type { LearningEvent } from "../packages/learning-engine/src/model";

describe("the built-in lesson is internally consistent", () => {
  it("preserves all 15 approved dialogue turns and 25 visible sentences", () => {
    const designFile = readdirSync(resolve("docs")).find((name) =>
      /^00001_.*开发设计文档.*\.md$/.test(name),
    );
    expect(designFile).toBeDefined();
    const document = readFileSync(resolve("docs", designFile!), "utf8");
    const approvedTurns = [
      ...document.matchAll(/^(t\d{2}) ([^:\r\n]+): (.+)$/gm),
    ].map((match) => ({
      id: match[1],
      speaker: match[2],
      text: match[3].trim(),
    }));
    expect(approvedTurns).toHaveLength(15);
    expect(
      course.turns.map(({ id, speaker, text }) => ({ id, speaker, text })),
    ).toEqual(approvedTurns);
    expect(new Set(course.turns.map((turn) => turn.id)).size).toBe(15);
    expect(sentences).toHaveLength(25);
    expect(
      ["A", "B", "C"].map(
        (block) =>
          sentences.filter((sentence) => sentence.block === block).length,
      ),
    ).toEqual([9, 9, 7]);
    expect(sentences[0].text).toBe("Look.");
    expect(sentences[24].text).toBe("You'll be a good player.");
  });

  it("covers all seven stages without duplicate exercise ids or dangling choices/tokens", () => {
    expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(
      exercises.length,
    );
    expect(stageDefinitions.map((stage) => stage.id)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
      "S7",
    ]);
    expect(
      stageDefinitions.map(
        (stage) =>
          exercises.filter((exercise) => exercise.stageId === stage.id).length,
      ),
    ).toEqual([6, 16, 12, 3, 3, 25, 6]);
    for (const exercise of exercises) {
      expect(exercise.familyId).not.toBe("");
      expect(exercise.target.knowledgeId).not.toBe("");
      if (exercise.kind === "choice") {
        expect(new Set(exercise.options?.map((option) => option.id)).size).toBe(
          exercise.options?.length,
        );
        expect(
          exercise.correctOptionIds?.every((id) =>
            exercise.options?.some((option) => option.id === id),
          ),
        ).toBe(true);
      }
      if (exercise.kind === "order") {
        expect(new Set(exercise.tokens?.map((token) => token.id)).size).toBe(
          exercise.tokens?.length,
        );
        expect(new Set(exercise.correctTokenIds)).toEqual(
          new Set(exercise.tokens?.map((token) => token.id)),
        );
        const reconstructed = exercise.correctTokenIds
          ?.map((id) => exercise.tokens?.find((token) => token.id === id)?.text)
          .join(" ");
        expect(exercise.acceptedAnswers).toContain(reconstructed);
      }
    }
  });

  it("uses percentage thresholds and accepts every frozen reference answer", () => {
    for (const exercise of exercises) {
      if (exercise.kind === "sentence")
        expect(exercise.threshold, exercise.id).toBeGreaterThanOrEqual(85);
      expect(exercise.threshold).toBeLessThanOrEqual(100);
      if (exercise.kind === "oral") continue;
      const selectedIds =
        exercise.correctOptionIds ?? exercise.correctTokenIds ?? [];
      for (const answer of exercise.acceptedAnswers.length
        ? exercise.acceptedAnswers
        : [""]) {
        expect(
          gradeExercise(exercise, { answer, selectedIds }).passed,
          exercise.id,
        ).toBe(true);
      }
      expect(
        gradeExercise(exercise, { answer: "x", selectedIds: [] }).passed,
        `${exercise.id}: unrelated response`,
      ).toBe(false);
    }
  });

  it("offers genuinely different families for every non-fixed-text cell", () => {
    const families = new Map<string, Set<string>>();
    for (const exercise of exercises) {
      if (
        ["readAloud", "recall", "dictation"].includes(exercise.target.ability)
      )
        continue;
      const key = cellKey(exercise.target);
      if (!families.has(key)) families.set(key, new Set());
      families.get(key)!.add(exercise.familyId);
    }
    for (const [key, ids] of families)
      expect(ids.size, key).toBeGreaterThanOrEqual(2);
  });

  it("keeps ordering evidence separate from independent written sentence use", () => {
    const orders = exercises.filter(
      (exercise) => exercise.stageId === "S3" && exercise.kind === "order",
    );
    expect(
      orders.every((exercise) => exercise.target.mode === "recognition"),
    ).toBe(true);
    const events: LearningEvent[] = orders.map((exercise, index) => {
      const time = `2026-10-${11 + index}T09:00:00.000Z`;
      return {
        id: `event-${index}`,
        learnerId: "child",
        type: "attempt",
        at: time,
        attempt: {
          id: `attempt-${index}`,
          clientEventId: `client-${index}`,
          learnerId: "child",
          sessionId: `session-${index}`,
          exerciseId: exercise.id,
          answer: "",
          selectedIds: exercise.correctTokenIds!,
          recordingPath: null,
          hintLevel: 0,
          submittedAt: time,
          localDate: time.slice(0, 10),
          timezone: "UTC",
          clockStatus: "normal",
          firstTest: true,
          grade: gradeExercise(exercise, {
            answer: "",
            selectedIds: exercise.correctTokenIds!,
          }),
        },
      };
    });
    const projection = projectLearning(
      events,
      exercises,
      "child",
      "2026-10-20T09:00:00.000Z",
    );
    const written = projection.skills.filter(
      (skill) => skill.ability === "usage" && skill.mode === "written",
    );
    expect(written).toHaveLength(3);
    expect(
      written.every(
        (skill) => skill.evidenceCount === 0 && skill.status === "unmeasured",
      ),
    ).toBe(true);
  });

  it("maps visible oral reference text to all corresponding dictation and recall targets", () => {
    for (const oral of exercises.filter(
      (exercise) => exercise.kind === "oral",
    )) {
      const block = oral.target.knowledgeId.slice(-1);
      const exposed = new Set(oral.exposureTargets?.map(cellKey));
      expect(
        exposed.has(
          cellKey({
            knowledgeId: `block.${block}`,
            ability: "recall",
            mode: "oral",
          }),
        ),
      ).toBe(true);
      sentences.forEach((sentence, index) => {
        if (sentence.block === block) {
          expect(
            exposed.has(
              cellKey({
                knowledgeId: `sentence.${String(index + 1).padStart(2, "0")}`,
                ability: "dictation",
                mode: "written",
              }),
            ),
          ).toBe(true);
        }
      });
    }
    for (const dictation of exercises.filter(
      (exercise) => exercise.stageId === "S6",
    )) {
      expect(
        dictation.exposureTargets?.some(
          (target) => cellKey(target) === cellKey(dictation.target),
        ),
      ).toBe(false);
    }
  });

  it("rejects changed polarity and wrong sports in the actual lesson exercises", () => {
    for (const exercise of exercises.filter(
      (exercise) => exercise.kind === "sentence",
    )) {
      const reference = exercise.acceptedAnswers[0];
      if (reference.includes("won't") || /\bnot\b/.test(reference)) {
        const wrongPolarity = reference
          .replace("won't", "will")
          .replace(/\bnot\s*/g, "");
        expect(
          gradeExercise(exercise, { answer: wrongPolarity, selectedIds: [] })
            .passed,
          exercise.id,
        ).toBe(false);
      }
      if (/basketball|football|ping-pong/.test(reference)) {
        const changedSport = reference.replace(
          /basketball|football|ping-pong/g,
          "volleyball",
        );
        expect(
          gradeExercise(exercise, { answer: changedSport, selectedIds: [] })
            .passed,
          exercise.id,
        ).toBe(false);
      }
    }
    const decline = exercises.find((exercise) => exercise.id === "s7-decline")!;
    expect(
      gradeExercise(decline, { answer: "No, I will.", selectedIds: [] }).passed,
    ).toBe(false);
    expect(
      gradeExercise(decline, { answer: "No, I will not.", selectedIds: [] })
        .passed,
    ).toBe(true);
    const invitation = exercises.find(
      (exercise) => exercise.id === "s7-invite-team",
    )!;
    expect(
      gradeExercise(invitation, {
        answer: "Will I join the football team?",
        selectedIds: [],
      }).passed,
    ).toBe(false);
  });
});
