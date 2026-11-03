import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractDirective, opposedDirectiveCheck } from "../src/checks/opposed-directive.js";
import { parseRules } from "../src/parse.js";
import type { ParsedRulesFile } from "../src/types.js";

function parsedFile(root: string, relativePath: string, markdown: string): ParsedRulesFile {
  const filePath = path.join(root, relativePath);
  return { path: filePath, type: "agents", ...parseRules(markdown, { root, filePath }) };
}

function issues(root: string, files: ParsedRulesFile[]) {
  return opposedDirectiveCheck.run({ root, files });
}

describe("opposed-directive", () => {
  it("extracts positive and negative polarity and skips mixed preferences", () => {
    expect(extractDirective("Always use semicolons consistently")?.polarity).toBe("positive");
    expect(extractDirective("Never use semicolons consistently")?.polarity).toBe("negative");
    expect(extractDirective("Use semicolons, never use commas")).toBeUndefined();
    expect(extractDirective("Prefer semicolons rather than commas")).toBeUndefined();
  });

  it("reports the planted conflict and skips each scoped or exceptional case", () => {
    const root = path.resolve("tests/fixtures/directive-repo");
    const markdown = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const findings = issues(root, [parsedFile(root, "AGENTS.md", markdown)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "opposed-directive",
      severity: "warning",
      file: path.join(root, "AGENTS.md"),
      line: 4,
      message: 'This rule conflicts with AGENTS.md:3 ("Always use semicolons consistently.").',
    });
  });

  it("skips rules under different headings and nested files in different directories", () => {
    const root = "/repo";
    const rootRules = parsedFile(root, "AGENTS.md", [
      "# Frontend", "", "- Always use the same shared components consistently.", "",
      "# Backend", "", "- Never use the same shared components consistently.",
    ].join("\n"));
    const nested = parsedFile(root, "packages/app/CLAUDE.md", "- Never use the same shared components consistently.");
    expect(issues(root, [rootRules])).toEqual([]);
    expect(issues(root, [parsedFile(root, "AGENTS.md", "- Always use the same shared components consistently."), nested])).toEqual([]);
  });

  it("skips conditional rules, narrow exceptions, and generic-only overlap", () => {
    const root = "/repo";
    const markdown = [
      "- Always use semicolons when formatting source files.",
      "- Never use semicolons when formatting source files.",
      "- Always use semicolons consistently across source files.",
      "- Never use semicolons consistently in legacy.ts.",
      "- Always add code comments.",
      "- Never add code comments.",
    ].join("\n");
    expect(issues(root, [parsedFile(root, "AGENTS.md", markdown)])).toEqual([]);
  });

  it("does not extract fenced code examples as rules", () => {
    const root = "/repo";
    const markdown = "```md\n- Always use semicolons consistently.\n- Never use semicolons consistently.\n```";
    expect(parsedFile(root, "AGENTS.md", markdown).rules).toEqual([]);
  });
});
