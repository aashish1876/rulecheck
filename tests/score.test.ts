import { describe, expect, it } from "vitest";
import { gradeForScore, score, scoreConfig } from "../src/score.js";
import type { Issue } from "../src/types.js";

function issue(ruleId: string, severity: Issue["severity"]): Issue {
  return { ruleId, severity, message: "test", file: "AGENTS.md", line: 1 };
}

describe("score", () => {
  it("returns 100 with no issues and no penalty for info", () => {
    expect(score([], { files: 1 })?.score).toBe(100);
    expect(score([issue("info-check", "info")], { files: 1 })?.score).toBe(100);
  });

  it("subtracts ten points for one error", () => {
    expect(score([issue("check", "error")], { files: 1 })?.score).toBe(90);
    expect(score([
      { ...issue("check", "warning"), line: 1 },
      { ...issue("check", "warning"), line: 2 },
    ], { files: 1 })?.score).toBe(92);
  });

  it("counts only the worst issue at each file and line", () => {
    const issues: Issue[] = [
      { ...issue("warning-check", "warning"), file: "AGENTS.md", line: 4 },
      { ...issue("error-check", "error"), file: "AGENTS.md", line: 4 },
      { ...issue("info-check", "info"), file: "AGENTS.md", line: 4 },
      { ...issue("warning-check", "warning"), file: "AGENTS.md", line: 5 },
    ];
    const result = score(issues, { files: 1 });
    expect(result?.score).toBe(86);
    expect(result?.breakdown).toEqual([
      { ruleId: "error-check", errors: 1, warnings: 0, penalty: 10 },
      { ruleId: "warning-check", errors: 0, warnings: 1, penalty: 4 },
    ]);
    expect(issues).toHaveLength(4);
  });

  it("caps each rule penalty and floors the total score at zero", () => {
    const noisy = Array.from({ length: 7 }, (_, index) => ({ ...issue("noisy", "error"), line: index + 1 }));
    const capped = score(noisy, { files: 1 });
    expect(capped?.score).toBe(60);
    expect(capped?.breakdown[0]?.penalty).toBe(scoreConfig.maxPenaltyPerRule);
    let line = 0;
    const several = ["one", "two", "three"].flatMap((ruleId) => Array.from({ length: 5 }, () => ({ ...issue(ruleId, "error"), line: ++line })));
    expect(score(several, { files: 1 })?.score).toBe(0);
  });

  it("applies grade boundaries", () => {
    expect(gradeForScore(90)).toBe("Excellent");
    expect(gradeForScore(89)).toBe("Good");
    expect(gradeForScore(75)).toBe("Good");
    expect(gradeForScore(74)).toBe("Needs work");
    expect(gradeForScore(50)).toBe("Needs work");
    expect(gradeForScore(49)).toBe("Poor");
    expect(gradeForScore(0)).toBe("Poor");
  });

  it("returns null when no rules files exist", () => {
    expect(score([], { files: 0 })).toBeNull();
  });
});
