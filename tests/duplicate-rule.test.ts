import { describe, expect, it } from "vitest";
import path from "node:path";
import { duplicateRuleCheck, normalizeRule } from "../src/checks/duplicate-rule.js";
import type { ParsedRulesFile, Rule } from "../src/types.js";

function parsedFile(filePath: string, rules: Rule[]): ParsedRulesFile {
  return { path: filePath, type: "agents", headings: [], rules, filePaths: [], commands: [] };
}

describe("duplicate-rule", () => {
  it("normalizes markdown, punctuation, case, and stop words", () => {
    expect(normalizeRule("**Write** the clear-error messages, for users!")).toEqual(["write", "clear", "error", "messages", "users"]);
  });

  it("distinguishes exact duplicates from near duplicates at the threshold", () => {
    const file = parsedFile("/repo/AGENTS.md", [
      { text: "Write clear error messages for failed network requests before returning results.", line: 1, parentHeading: null },
      { text: "Write clear error messages for failed network requests before returning results.", line: 2, parentHeading: null },
      { text: "Write clear error messages for unsuccessful network requests before returning results.", line: 3, parentHeading: null },
    ]);
    const issues = duplicateRuleCheck.run({ root: "/repo", files: [file] });
    expect(issues.map(({ severity, message }) => [severity, message])).toEqual([
      ["warning", "Duplicate of rule at AGENTS.md:1"],
      ["info", "Near-duplicate of rule at AGENTS.md:1"],
    ]);
  });

  it("reports cross-file duplicates against the earlier path and skips short rules", () => {
    const later = parsedFile("/repo/CLAUDE.md", [
      { text: "Keep function and variable names descriptive throughout the codebase.", line: 4, parentHeading: null },
      { text: "Write clear rules.", line: 5, parentHeading: null },
    ]);
    const earlier = parsedFile("/repo/AGENTS.md", [
      { text: "Keep function and variable names descriptive throughout the codebase.", line: 12, parentHeading: null },
      { text: "Write clear rules.", line: 13, parentHeading: null },
    ]);
    const issues = duplicateRuleCheck.run({ root: "/repo", files: [later, earlier] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: path.join("/repo", "CLAUDE.md"), line: 4, severity: "warning",
      message: "Duplicate of rule at AGENTS.md:12", suggestion: "Remove one of them.",
    });
  });
});
