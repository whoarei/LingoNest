import { cellKey } from "../packages/learning-engine/src";
import type {
  Ability,
  Exercise,
  SkillState,
} from "../packages/learning-engine/src/model";
import type { HistoryItem } from "./domain";

export type ParentTab =
  | "overview"
  | "confirm"
  | "report"
  | "course"
  | "profiles";
export const parentNav = [
  { id: "overview", label: "概况", icon: "home" },
  { id: "confirm", label: "确认", icon: "mic" },
  { id: "report", label: "报告", icon: "chart" },
  { id: "course", label: "课程", icon: "book" },
] as const;
export const abilityLabels: Record<Ability, string> = {
  meaning: "词义理解",
  spelling: "单词拼写",
  usage: "句型运用",
  readAloud: "看文朗读",
  recall: "课文回忆",
  dictation: "句子默写",
  transfer: "情境应用",
};
export const statusLabels: Record<SkillState["status"], string> = {
  unmeasured: "还未测试",
  learning: "正在学习",
  mastered: "已掌握",
  review_due: "需要复习",
};

export function answerText(item: HistoryItem, reference = false): string {
  const exercise = item.exercise;
  if (exercise.kind === "oral")
    return reference
      ? exercise.referenceText || exercise.acceptedAnswers.join(" / ")
      : "录音作答";
  if (exercise.kind === "choice") {
    const ids = reference ? exercise.correctOptionIds || [] : item.selectedIds;
    return (
      ids
        .map(
          (id) =>
            exercise.options?.find((option) => option.id === id)?.text || "",
        )
        .join(" / ") || "未作答"
    );
  }
  if (exercise.kind === "order") {
    const ids = reference ? exercise.correctTokenIds || [] : item.selectedIds;
    return (
      ids
        .map(
          (id) => exercise.tokens?.find((token) => token.id === id)?.text || "",
        )
        .join(" ")
        .replace(/\s+([.,!?])/g, "$1") || "未作答"
    );
  }
  return reference
    ? exercise.acceptedAnswers.join(" / ")
    : item.answer || "未作答";
}

export function attemptLabel(item: HistoryItem): string {
  if (item.grade.status === "needs_review") return "待家长确认";
  if (item.grade.status === "unscorable") return "暂不可评价";
  return item.grade.passed ? "本次通过" : "还需练习";
}

export function buildParentReport(
  history: readonly HistoryItem[],
  skills: readonly SkillState[],
  exercises: readonly Exercise[],
) {
  const sorted = [...history].sort((a, b) =>
    b.submittedAt.localeCompare(a.submittedAt),
  );
  const targets = [
    ...new Map(
      exercises.map((exercise) => [cellKey(exercise.target), exercise]),
    ).entries(),
  ].map(([key, exercise]) => {
    const skill = skills.find((item) => item.key === key);
    const attempts = sorted.filter(
      (item) => cellKey(item.exercise.target) === key,
    );
    const pending = attempts.filter(
      (item) => item.grade.status === "needs_review",
    ).length;
    const label =
      skill && skill.evidenceCount > 0
        ? statusLabels[skill.status]
        : pending
          ? "待家长确认"
          : attempts.length
            ? "尚无独立测评"
            : "还未测试";
    const title = exercise.kind === "oral" ? exercise.title : exercise.prompt;
    return { key, exercise, title, skill, attempts, pending, label };
  });
  const abilities = (Object.keys(abilityLabels) as Ability[]).map((ability) => {
    const items = targets.filter(
      (item) => item.exercise.target.ability === ability,
    );
    return {
      ability,
      label: abilityLabels[ability],
      total: items.length,
      measured: items.filter((item) => (item.skill?.evidenceCount || 0) > 0)
        .length,
      mastered: items.filter((item) => item.skill?.status === "mastered")
        .length,
      pending: items.reduce((total, item) => total + item.pending, 0),
    };
  });
  const attention = targets.filter(
    (item) =>
      item.skill &&
      item.skill.evidenceCount > 0 &&
      item.skill.latestPassed === false,
  );
  return { targets, abilities, attention, recent: sorted.slice(0, 6) };
}
