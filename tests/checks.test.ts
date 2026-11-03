import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRules } from "../src/parse.js";
import { runChecks } from "../src/checks/index.js";
import { checks } from "../src/checks/index.js";
import type { ParsedRulesFile } from "../src/types.js";

const fixtures = path.resolve("tests/fixtures");

function loadFixture(name: string): { root: string; file: ParsedRulesFile } {
  const root = path.join(fixtures, name);
  const filePath = path.join(root, "AGENTS.md");
  return { root, file: { path: filePath, type: "agents", ...parseRules(readFileSync(filePath, "utf8")) } };
}

describe("built-in checks", () => {
  it("reports stale paths and supported commands while skipping safe cases", () => {
    const { root, file } = loadFixture("stale-repo");
    const issues = runChecks({ root, files: [file] });
    const pathIssues = issues.filter((issue) => issue.ruleId === "stale-path");
    const commandIssues = issues.filter((issue) => issue.ruleId === "stale-command");

    expect(pathIssues.map((issue) => issue.message)).toEqual([
      'Path "src/utlis/" does not exist. Did you mean "src/utils/"?',
    ]);
    expect(pathIssues.some((issue) => /dist|coverage|example\.com|source-dir|BUILD_TASK|name|folder|docs\//.test(issue.message))).toBe(false);
    expect(commandIssues.some((issue) => issue.message.includes('Script "test:unitt" not found'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes('Script "not-found" not found'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes('Make target "release"'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes('scripts/missing.js'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes('scripts/missing.py'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes('scripts/missing.sh'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes('./scripts/missing.sh'))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes("uses pnpm"))).toBe(true);
    expect(commandIssues.some((issue) => issue.message.includes("pytest"))).toBe(false);
    expect(commandIssues.filter((issue) => issue.message.includes('Script "not-found" not found')).map((issue) => issue.line)).toEqual([17, 18, 19]);
  });

  it("accepts valid paths and supported command forms", () => {
    const { root, file } = loadFixture("clean-repo");
    expect(runChecks({ root, files: [file] }).filter((issue) => issue.severity !== "info")).toEqual([]);
    expect(runChecks({ root, files: [file] }).some((issue) => issue.ruleId === "contradiction")).toBe(false);
  });

  it("suggests case-correct paths", () => {
    const root = path.join(fixtures, "clean-repo");
    const file: ParsedRulesFile = {
      path: path.join(root, "AGENTS.md"), type: "agents", headings: [], rules: [], commands: [],
      filePaths: [{ value: "src/OK.ts", line: 42 }],
    };
    expect(runChecks({ root, files: [file] }).find((issue) => issue.ruleId === "stale-path")?.suggestion).toBe('Did you mean "src/ok.ts"?');
  });

  it("accepts bare filenames found in a subfolder but reports missing files", () => {
    const root = path.join(fixtures, "clean-repo");
    const file: ParsedRulesFile = {
      path: path.join(root, "AGENTS.md"), type: "agents", headings: [], rules: [], commands: [],
      filePaths: [{ value: "ok.ts", line: 1 }, { value: "Dockerfile", line: 2 }],
    };
    const issues = runChecks({ root, files: [file] }).filter((issue) => issue.ruleId === "stale-path");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe('Path "Dockerfile" does not exist.');
  });

  it("reports only the planted broken path among slash alternatives in prose", () => {
    const root = path.join(fixtures, "prose-repo");
    const filePath = path.join(root, "AGENTS.md");
    const content = readFileSync(filePath, "utf8");
    const file: ParsedRulesFile = {
      path: filePath, type: "agents", ...parseRules(content, { root, filePath }), content,
    };
    const issues = runChecks({ root, files: [file] }).filter((issue) => issue.ruleId === "stale-path");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('Path "src/missing.ts" does not exist.');
  });

  it("reports a paragraph path on the line where the reference appears", () => {
    const root = path.join(fixtures, "realworld-repo");
    const filePath = path.join(root, ".github/CLAUDE.md");
    const content = "The start of the paragraph is here,\nand the missing import @.claude/MISSING.md appears here.";
    const file: ParsedRulesFile = { path: filePath, type: "claude", ...parseRules(content), content };
    const issue = runChecks({ root, files: [file] }).find((item) => item.ruleId === "stale-path");
    expect(issue).toMatchObject({ line: 2, message: 'Path ".claude/MISSING.md" does not exist.' });
  });

  it("skips real-world prose and generated-path false positives", () => {
    const root = path.join(fixtures, "realworld-repo");
    const files = ["AGENTS.md", ".github/CLAUDE.md"].map((relative) => {
      const filePath = path.join(root, relative);
      const content = readFileSync(filePath, "utf8");
      return { path: filePath, type: relative === "AGENTS.md" ? "agents" as const : "claude" as const, ...parseRules(content, { root, filePath }), content };
    });
    expect(runChecks({ root, files }).filter((issue) => issue.ruleId === "stale-path")).toEqual([]);
  });

  it("estimates token cost, reports the largest section, and totals root files", () => {
    const root = path.join(fixtures, "clean-repo");
    const content = `# Guide\n## Small\n${"a".repeat(20)}\n\n## Largest\n${"b".repeat(24_100)}`;
    const file: ParsedRulesFile = {
      path: path.join(root, "AGENTS.md"), type: "agents", ...parseRules(content), content,
    };
    const issues = runChecks({ root, files: [file] }).filter((issue) => issue.ruleId === "token-cost");
    expect(issues.map((issue) => issue.severity)).toEqual(["info", "warning"]);
    expect(issues[0]?.message).toContain(`~${Math.ceil(content.length / 4).toLocaleString("en-US")} tokens`);
    expect(issues[1]?.message).toContain('Largest section: "Largest"');
    const secondFile = { ...file, path: path.join(root, "CLAUDE.md") };
    const combined = runChecks({ root, files: [file, secondFile] }).find((issue) => issue.message.startsWith("Combined estimate"));
    expect(combined?.message).toContain(`Combined estimate for root-level rules files: ~${(Math.ceil(content.length / 4) * 2).toLocaleString("en-US")} tokens`);
  });

  it("omits combined token estimate for a single root file", () => {
    const { root, file } = loadFixture("clean-repo");
    expect(runChecks({ root, files: [{ ...file, content: "short" }] }).some((issue) => issue.message.startsWith("Combined estimate"))).toBe(false);
  });

  it("warns at 5,000 tokens without errors or an H1 whole-file hint", () => {
    const root = path.join(fixtures, "clean-repo");
    const heading = "# Whole file title\n";
    const content = `${heading}${"x".repeat(20_000 - heading.length)}`;
    const file: ParsedRulesFile = {
      path: path.join(root, "AGENTS.md"), type: "agents", ...parseRules(content), content,
    };
    const issues = runChecks({ root, files: [file] }).filter((issue) => issue.ruleId === "token-cost");
    expect(issues.map((issue) => issue.severity)).toEqual(["info", "warning"]);
    expect(issues[1]?.message).toContain("~5,000 tokens");
    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(issues[1]?.message).not.toContain("Largest section:");
  });

  it("drops identical issues from different checks", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rulecheck-"));
    const check = {
      id: "test-duplicate", description: "test duplicate", run: () => [{
        ruleId: "same", severity: "error" as const, message: "same issue", file: path.join(root, "rules.md"), line: 3,
      }],
    };
    checks.push(check);
    try {
      expect(runChecks({ root, files: [] }).filter((issue) => issue.ruleId === "same")).toHaveLength(1);
    } finally {
      checks.pop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs checks on only the first of byte-identical rules files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rulecheck-identical-"));
    try {
      const content = "# Rules\n\n- Use package.json for project metadata.\n";
      const files = ["AGENTS.md", "CLAUDE.md"].map((name) => {
        const filePath = path.join(root, name);
        writeFileSync(filePath, content);
        return { path: filePath, type: name === "AGENTS.md" ? "agents" as const : "claude" as const, ...parseRules(content), content };
      });
      const issues = runChecks({ root, files });
      expect(issues.filter((issue) => issue.ruleId === "duplicate-rule")).toMatchObject([
        { severity: "info", file: files[1]?.path, message: "Identical to AGENTS.md" },
      ]);
      expect(issues.filter((issue) => issue.ruleId === "token-cost")).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
