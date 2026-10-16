import type {
  Attempt,
  CellRef,
  EvaluatedAttempt,
  Exercise,
  GradeResult,
  LearningEvent,
  Projection,
  SkillState,
} from "./model";

export * from "./model";

const DAY = 86_400_000;
const INTERVALS = [1, 3, 7, 14, 30] as const;
const lexical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The host scopes this key to its learner, package namespace and semantic version. */
export const cellKey = (cell: CellRef): string =>
  JSON.stringify([cell.knowledgeId, cell.ability, cell.mode]);

function normalize(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokens(text: string): string[] {
  return normalize(text).match(/[a-z]+(?:['-][a-z]+)*|\d+|[^\s\p{P}]/gu) ?? [];
}

function distance(left: readonly string[], right: readonly string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

const accuracy = (a: readonly string[], b: readonly string[]): number =>
  Math.max(0, 1 - distance(a, b) / Math.max(a.length, b.length, 1));

function guardTokens(text: string): string[] {
  return tokens(text).flatMap((token) => {
    if (token === "won't") return ["will", "not"];
    if (token === "can't" || token === "cannot") return ["can", "not"];
    if (token.endsWith("n't")) return [token.slice(0, -3), "not"];
    return [token];
  });
}

function criticalChecks(
  exercise: Exercise,
  reference: string,
  response: string,
): boolean {
  const expected = guardTokens(reference);
  const actual = guardTokens(response);
  // Polarity is always protected, including when a pack forgot an explicit critical token.
  for (const negative of ["no", "not", "never"]) {
    if (
      expected.filter((token) => token === negative).length !==
      actual.filter((token) => token === negative).length
    )
      return false;
  }
  return (exercise.criticalTokens ?? []).every((critical) => {
    const sequence = guardTokens(critical);
    if (sequence.length === 0) return false;
    return actual.some((_, index) =>
      sequence.every((token, offset) => actual[index + offset] === token),
    );
  });
}

export function gradeExercise(
  exercise: Exercise,
  response: {
    answer: string;
    selectedIds: string[];
    recordingPath?: string | null;
  },
): GradeResult {
  const normalizedAnswer = normalize(response.answer);
  const result = (
    score: number,
    passed: boolean,
    feedback: string,
  ): GradeResult => ({
    status: "scored",
    score,
    passed,
    source: "local",
    feedback,
    normalizedAnswer,
    policyVersion: "2",
  });
  const unscorable = (feedback: string): GradeResult => ({
    status: "unscorable",
    score: null,
    passed: null,
    source: "local",
    feedback,
    normalizedAnswer,
    policyVersion: "2",
  });

  if (exercise.kind === "oral") {
    return response.recordingPath?.trim()
      ? {
          status: "needs_review",
          score: null,
          passed: null,
          source: "local",
          feedback: "录音已保存，请家长回听确认。",
          normalizedAnswer,
          policyVersion: "2",
        }
      : unscorable("请先完成录音，再提交这项练习。");
  }
  if (exercise.kind === "choice" || exercise.kind === "order") {
    const expected =
      exercise.kind === "choice"
        ? exercise.correctOptionIds
        : exercise.correctTokenIds;
    if (!expected?.length || new Set(expected).size !== expected.length)
      return unscorable("题目答案配置不完整。");
    const actual = response.selectedIds;
    const passed =
      actual.length === expected.length &&
      new Set(actual).size === actual.length &&
      (exercise.kind === "choice"
        ? expected.every((id) => actual.includes(id))
        : expected.every((id, index) => actual[index] === id));
    return result(
      passed ? 100 : 0,
      passed,
      passed ? "回答正确。" : "再检查一下选项或词语顺序。",
    );
  }
  const answers = exercise.acceptedAnswers.filter(
    (answer) => normalize(answer).length > 0,
  );
  if (!answers.length) return unscorable("题目尚未配置可评分的参考答案。");
  if (!normalizedAnswer) return result(0, false, "还没有填写答案。");

  if (exercise.kind === "spelling") {
    const passed = answers.some(
      (answer) => normalize(answer) === normalizedAnswer,
    );
    const score = Math.max(
      ...answers.map(
        (answer) =>
          100 * accuracy([...normalize(answer)], [...normalizedAnswer]),
      ),
    );
    return result(
      score,
      passed,
      passed ? "拼写正确。" : "请对照答案检查字母；拼写需要完全正确。",
    );
  }
  if (
    !Number.isFinite(exercise.threshold) ||
    exercise.threshold < 0 ||
    exercise.threshold > 100
  ) {
    return unscorable("题目的通过门槛配置无效。");
  }
  // Evaluate each approved answer as a complete path; never combine fragments across alternatives.
  const paths = answers
    .map((reference) => {
      const characterPath = (text: string): string[] => [
        ...normalize(text)
          .replace(/[.,!?;:"]/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      ];
      const score =
        100 *
        ((7 / 9) * accuracy(tokens(reference), tokens(response.answer)) +
          (2 / 9) *
            accuracy(characterPath(reference), characterPath(response.answer)));
      const critical = criticalChecks(exercise, reference, response.answer);
      return {
        score,
        critical,
        passed: score >= exercise.threshold && critical,
      };
    })
    .sort((a, b) => Number(b.passed) - Number(a.passed) || b.score - a.score);
  const best = paths[0];
  return result(
    best.score,
    best.passed,
    best.passed
      ? "表达符合本题要求。"
      : best.critical
        ? "请检查漏词、词序和拼写。"
        : "请检查否定表达或题目要求的关键词。",
  );
}

interface MutableCell {
  state: SkillState;
  families: Set<string>;
  trustedDays: Set<string>;
  trustedSessions: Set<string>;
  familyDays: Set<string>;
  dailyWeights: Map<string, number>;
  anchor: number | null;
  lastPromotionDay: string | null;
  humanVerified: boolean;
  latestClockNormal: boolean;
}

function createCell(target: CellRef): MutableCell {
  return {
    state: {
      ...target,
      key: cellKey(target),
      alpha: 1,
      beta: 1,
      mastery: 0.5,
      evidenceCount: 0,
      effectiveWeight: 0,
      status: "unmeasured",
      latestPassed: null,
      dueAt: null,
      eligibleAt: null,
      reviewLevel: 0,
      delayedPass: false,
    },
    families: new Set(),
    trustedDays: new Set(),
    trustedSessions: new Set(),
    familyDays: new Set(),
    dailyWeights: new Map(),
    anchor: null,
    lastPromotionDay: null,
    humanVerified: false,
    latestClockNormal: false,
  };
}

function advanceAnchor(cell: MutableCell, at: number): void {
  cell.anchor = Math.max(cell.anchor ?? at, at);
  cell.state.eligibleAt = new Date(cell.anchor + DAY).toISOString();
}

/** Event array order is the durable journal order, including CAS and equal-time ordering. */
export function projectLearning(
  events: readonly LearningEvent[],
  exercises: readonly Exercise[],
  learnerId: string,
  nowIso: string,
): Projection {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now))
    throw new RangeError("nowIso must be an ISO timestamp");
  const exerciseById = new Map(
    exercises.map((exercise) => [exercise.id, exercise]),
  );
  const cells = new Map<string, MutableCell>();
  for (const exercise of exercises) {
    const key = cellKey(exercise.target);
    if (!cells.has(key)) cells.set(key, createCell(exercise.target));
  }
  const seenEventIds = new Set<string>();
  const seenClientIds = new Set<string>();
  const attempts = new Map<
    string,
    { attempt: EvaluatedAttempt; sequence: number }
  >();
  const exposures: { targets: CellRef[]; at: number; sequence: number }[] = [];

  events.forEach((event, sequence) => {
    if (event.learnerId !== learnerId || seenEventIds.has(event.id)) return;
    seenEventIds.add(event.id);
    if (event.type === "attempt") {
      const attempt = event.attempt;
      if (
        attempt.learnerId !== learnerId ||
        !exerciseById.has(attempt.exerciseId) ||
        attempts.has(attempt.id) ||
        seenClientIds.has(attempt.clientEventId) ||
        !Number.isFinite(Date.parse(attempt.submittedAt))
      )
        return;
      seenClientIds.add(attempt.clientEventId);
      attempts.set(attempt.id, {
        attempt: {
          ...attempt,
          selectedIds: [...attempt.selectedIds],
          grade: { ...attempt.grade },
          reviewRevision: 0,
        },
        sequence,
      });
    } else if (event.type === "review") {
      const stored = attempts.get(event.attemptId);
      if (!stored || event.expectedRevision !== stored.attempt.reviewRevision)
        return;
      const exercise = exerciseById.get(stored.attempt.exerciseId)!;
      // This vertical slice exposes only audio review; deterministic text results cannot be overridden.
      if (exercise.kind !== "oral" || !stored.attempt.recordingPath?.trim())
        return;
      stored.attempt = {
        ...stored.attempt,
        reviewRevision: stored.attempt.reviewRevision + 1,
        grade: {
          ...stored.attempt.grade,
          status: "scored",
          score: event.passed ? 100 : 0,
          passed: event.passed,
          source: "human",
          feedback: event.passed ? "人工确认通过。" : "人工确认需要再练习。",
          policyVersion: "2",
        },
      };
    } else {
      const at = Date.parse(event.at);
      if (Number.isFinite(at))
        exposures.push({ targets: event.targets, at, sequence });
    }
  });

  type Action = {
    at: number;
    sequence: number;
    attempt?: EvaluatedAttempt;
    targets?: CellRef[];
  };
  const actions: Action[] = [
    ...[...attempts.values()].map(({ attempt, sequence }) => ({
      at: Date.parse(attempt.submittedAt),
      sequence,
      attempt,
    })),
    ...exposures,
  ].sort((a, b) => a.sequence - b.sequence);

  for (const action of actions) {
    if (action.targets) {
      for (const target of action.targets) {
        const cell = cells.get(cellKey(target));
        if (cell) advanceAnchor(cell, action.at);
      }
      continue;
    }
    const attempt = action.attempt!;
    const exercise = exerciseById.get(attempt.exerciseId)!;
    const cell = cells.get(cellKey(exercise.target))!;
    const { state } = cell;
    if (
      attempt.grade.status !== "scored" ||
      typeof attempt.grade.passed !== "boolean" ||
      attempt.hintLevel !== 0 ||
      !attempt.firstTest
    )
      continue;
    const passed = attempt.grade.passed;
    const trusted = attempt.clockStatus === "normal";
    state.latestPassed = passed;
    cell.latestClockNormal = trusted;

    const familyDay = JSON.stringify([exercise.familyId, attempt.localDate]);
    if (!cell.familyDays.has(familyDay)) {
      cell.familyDays.add(familyDay);
      const baseWeight =
        attempt.grade.source === "human" ||
        (exercise.kind !== "choice" &&
          exercise.kind !== "order" &&
          exercise.kind !== "oral")
          ? 1
          : 0.5;
      const used = cell.dailyWeights.get(attempt.localDate) ?? 0;
      const weight = Math.min(baseWeight, Math.max(0, 2 - used));
      if (weight > 0) {
        state.alpha += weight * Number(passed);
        state.beta += weight * Number(!passed);
        state.effectiveWeight += weight;
        state.evidenceCount++;
        cell.dailyWeights.set(attempt.localDate, used + weight);
        cell.families.add(exercise.familyId);
        if (trusted) {
          cell.trustedDays.add(attempt.localDate);
          cell.trustedSessions.add(attempt.sessionId);
          if (passed && attempt.grade.source === "human")
            cell.humanVerified = true;
        }
      }
    }

    if (!passed) {
      state.reviewLevel = 0;
      state.delayedPass = false;
      if (trusted) state.dueAt = new Date(action.at + DAY).toISOString();
    } else if (
      trusted &&
      state.dueAt !== null &&
      cell.anchor !== null &&
      action.at >= Date.parse(state.dueAt) &&
      action.at - cell.anchor >= DAY &&
      cell.lastPromotionDay !== attempt.localDate
    ) {
      state.reviewLevel = Math.min(state.reviewLevel + 1, INTERVALS.length - 1);
      state.dueAt = new Date(
        action.at + INTERVALS[state.reviewLevel] * DAY,
      ).toISOString();
      state.delayedPass = true;
      cell.lastPromotionDay = attempt.localDate;
    }
    // A suspect clock may retain a practice result, but cannot advance a trusted delay anchor or prove a learning day.
    if (trusted) {
      if (state.dueAt === null)
        state.dueAt = new Date(action.at + DAY).toISOString();
      advanceAnchor(cell, action.at);
    }
  }

  const skills = [...cells.values()].map((cell) => {
    const { state } = cell;
    state.mastery = state.alpha / (state.alpha + state.beta);
    const fixedText = ["readAloud", "recall", "dictation"].includes(
      state.ability,
    );
    const independent = fixedText
      ? cell.trustedDays.size >= 3 && cell.trustedSessions.size >= 3
      : cell.trustedDays.size >= 2 && cell.families.size >= 2;
    const oralVerified = state.mode !== "oral" || cell.humanVerified;
    const mastered =
      state.mastery >= 0.8 &&
      state.evidenceCount >= 3 &&
      state.effectiveWeight >= 3 &&
      independent &&
      oralVerified &&
      state.delayedPass &&
      state.latestPassed === true &&
      cell.latestClockNormal;
    state.status =
      state.latestPassed === false
        ? "review_due"
        : state.evidenceCount === 0
          ? "unmeasured"
          : mastered
            ? state.dueAt !== null && Date.parse(state.dueAt) <= now
              ? "review_due"
              : "mastered"
            : "learning";
    return state;
  });
  return {
    attempts: [...attempts.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((item) => item.attempt),
    skills,
  };
}

/** One exercise per cell; future reviews wait, and families with fewer prior presentations are preferred. */
export function buildReviewQueue(
  projection: Projection,
  exercises: readonly Exercise[],
  nowIso: string,
): Exercise[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now))
    throw new RangeError("nowIso must be an ISO timestamp");
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const counts = new Map<string, number>();
  for (const attempt of projection.attempts) {
    const exercise = byId.get(attempt.exerciseId);
    if (exercise) counts.set(exercise.id, (counts.get(exercise.id) ?? 0) + 1);
  }
  const candidates = projection.skills.flatMap((skill) => {
    const unmeasured = skill.evidenceCount === 0 && skill.latestPassed === null;
    const due = skill.dueAt !== null ? Date.parse(skill.dueAt) : null;
    const eligible =
      skill.eligibleAt !== null ? Date.parse(skill.eligibleAt) : null;
    if (
      !unmeasured &&
      (due === null || eligible === null || due > now || eligible > now)
    )
      return [];
    const available = exercises.filter(
      (exercise) => cellKey(exercise.target) === skill.key,
    );
    const familyCount = (family: string): number =>
      available
        .filter((item) => item.familyId === family)
        .reduce((sum, item) => sum + (counts.get(item.id) ?? 0), 0);
    available.sort(
      (a, b) =>
        familyCount(a.familyId) - familyCount(b.familyId) ||
        (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) ||
        lexical(a.id, b.id),
    );
    const exercise = available[0];
    if (!exercise) return [];
    return [
      {
        skill,
        exercise,
        group: unmeasured ? 2 : skill.latestPassed === false ? 0 : 1,
        due: due ?? Infinity,
      },
    ];
  });
  candidates.sort(
    (a, b) =>
      a.group - b.group ||
      (a.group < 2 ? a.due - b.due || a.skill.mastery - b.skill.mastery : 0) ||
      lexical(a.exercise.stageId, b.exercise.stageId) ||
      lexical(a.skill.key, b.skill.key),
  );
  return candidates.slice(0, 12).map((candidate) => candidate.exercise);
}
