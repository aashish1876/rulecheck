import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
      ["warning", "Near-duplicate of rule at AGENTS.md:1"],
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
      file: path.join("/repo", "CLAUDE.md"), line: 4, severity: "info",
      message: "Duplicate of rule at AGENTS.md:12", suggestion: "Remove one of them.",
    });
  });

  it("reports identical same-directory files once and skips their rule comparison", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rulecheck-dupes-"));
    try {
      const content = "Keep function and variable names descriptive throughout the codebase.\n";
      const agentsPath = path.join(root, "AGENTS.md");
      const claudePath = path.join(root, "CLAUDE.md");
      writeFileSync(agentsPath, content);
      writeFileSync(claudePath, content);
      const rule = { text: content.trim(), line: 1, parentHeading: null };
      const issues = duplicateRuleCheck.run({
        root,
        files: [
          { ...parsedFile(agentsPath, [rule]), content },
          { ...parsedFile(claudePath, [rule]), content },
        ],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ severity: "info", file: claudePath, message: "CLAUDE.md is identical to AGENTS.md" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not compare rules across nested directories", () => {
    const files = [
      parsedFile("/repo/AGENTS.md", [{ text: "Keep function and variable names descriptive throughout the codebase.", line: 1, parentHeading: null }]),
      parsedFile("/repo/packages/app/CLAUDE.md", [{ text: "Keep function and variable names descriptive throughout the codebase.", line: 1, parentHeading: null }]),
    ];
    expect(duplicateRuleCheck.run({ root: "/repo", files })).toEqual([]);
  });
});
