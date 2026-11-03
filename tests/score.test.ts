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
    expect(score([issue("check", "warning"), issue("check", "warning")], { files: 1 })?.score).toBe(92);
  });

  it("caps each rule penalty and floors the total score at zero", () => {
    const noisy = Array.from({ length: 7 }, () => issue("noisy", "error"));
    const capped = score(noisy, { files: 1 });
    expect(capped?.score).toBe(60);
    expect(capped?.breakdown[0]?.penalty).toBe(scoreConfig.maxPenaltyPerRule);
    const several = ["one", "two", "three"].flatMap((ruleId) => Array.from({ length: 5 }, () => issue(ruleId, "error")));
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
