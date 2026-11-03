import type { Issue } from "./types.js";

export const scoreConfig = {
  errorPenalty: 10,
  warningPenalty: 4,
  maxPenaltyPerRule: 40,
} as const;

export interface ScoreStats {
  files: number;
}

export interface ScoreBreakdown {
  ruleId: string;
  errors: number;
  warnings: number;
  penalty: number;
}

export interface ScoreResult {
  score: number;
  grade: string;
  breakdown: ScoreBreakdown[];
}

export function gradeForScore(value: number): string {
  if (value >= 90) return "Excellent";
  if (value >= 75) return "Good";
  if (value >= 50) return "Needs work";
  return "Poor";
}

export function score(issues: Issue[], stats: ScoreStats): ScoreResult | null {
  if (stats.files === 0) return null;
  const totals = new Map<string, { errors: number; warnings: number }>();
  for (const issue of issues) {
    const entry = totals.get(issue.ruleId) ?? { errors: 0, warnings: 0 };
    if (issue.severity === "error") entry.errors += 1;
    if (issue.severity === "warning") entry.warnings += 1;
    totals.set(issue.ruleId, entry);
  }
  const breakdown = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ruleId, counts]) => ({
    ruleId,
    ...counts,
    penalty: Math.min(scoreConfig.maxPenaltyPerRule, counts.errors * scoreConfig.errorPenalty + counts.warnings * scoreConfig.warningPenalty),
  }));
  const penalty = breakdown.reduce((sum, item) => sum + item.penalty, 0);
  const resultScore = Math.max(0, Math.round(100 - penalty));
  return { score: resultScore, grade: gradeForScore(resultScore), breakdown };
}
