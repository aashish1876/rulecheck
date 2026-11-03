import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRules } from "../src/parse.js";
import { toolConflictCheck } from "../src/checks/tool-conflict.js";
import type { ParsedRulesFile } from "../src/types.js";

function file(root: string, relativePath: string, markdown: string): ParsedRulesFile {
  const filePath = path.join(root, relativePath);
  return { path: filePath, type: "agents", ...parseRules(markdown, { root, filePath }) };
}

function conflicts(root: string, files: ParsedRulesFile[]) {
  return toolConflictCheck.run({ root, files });
}

describe("tool-conflict", () => {
  it("reports the package manager, runner, and indentation conflicts once per group", () => {
    const root = path.resolve("tests/fixtures/conflict-repo");
    const markdown = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const parsed = file(root, "AGENTS.md", markdown);
    const issues = conflicts(root, [parsed]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'Rules recommend both "pnpm" (AGENTS.md:3) and "npm" (AGENTS.md:4).',
      'Rules recommend both "jest" (AGENTS.md:6) and "vitest" (AGENTS.md:7).',
      'Rules recommend both "tabs" (AGENTS.md:8) and "spaces" (AGENTS.md:9).',
    ]);
  });

  it("skips migration notes, comparisons, and explicitly different scopes", () => {
    const root = "/repo";
    const parsed = file(root, "AGENTS.md", [
      "We migrated from npm to pnpm.",
      "Compare jest and vitest before choosing.",
      "Prefer jest over vitest for UI tests.",
      "Frontend: use pnpm for browser assets.",
      "Backend: use npm for service scripts.",
      "Python: use pytest for server checks.",
      "JavaScript: use unittest for browser checks.",
    ].map((line) => `- ${line}`).join("\n"));
    expect(conflicts(root, [parsed])).toEqual([]);
  });

  it("skips negated recommendations", () => {
    const root = "/repo";
    const parsed = file(root, "AGENTS.md", [
      "Don't use npm for new scripts.",
      "Never use yarn in this repository.",
      "Always use pnpm for new scripts.",
    ].map((line) => `- ${line}`).join("\n"));
    expect(conflicts(root, [parsed])).toEqual([]);
  });

  it("skips each migration or negation form without treating it as a recommendation", () => {
    const root = "/repo";
    const parsed = file(root, "AGENTS.md", [
      "Use pnpm instead of npm.",
      "Always use pnpm, not npm.",
      "Use pnpm; migrated from npm.",
      "Use vitest; it replaces jest.",
      "Prefer vitest for all unit tests.",
    ].map((line) => `- ${line}`).join("\n"));
    expect(conflicts(root, [parsed])).toEqual([]);
  });

  it("does not treat non-shell code, npx, or npm-run-all as recommendations", () => {
    const root = "/repo";
    const parsed = file(root, "AGENTS.md", [
      "- Use pnpm for installs.",
      "- Use npm-run-all for parallel scripts.",
      "- Run npx jest for one-off checks.",
      "```json",
      '{"testRunner":"vitest"}',
      "```",
    ].join("\n"));
    expect(conflicts(root, [parsed])).toEqual([]);
  });

  it("reports cross-file conflicts only between root-level rules files", () => {
    const root = "/repo";
    const agents = file(root, "AGENTS.md", "- Always use pnpm for packages.");
    const claude = file(root, "CLAUDE.md", "- Prefer npm for packages.");
    const nested = file(root, "packages/app/AGENTS.md", "- Prefer npm for packages.");
    expect(conflicts(root, [agents, claude])).toHaveLength(1);
    expect(conflicts(root, [agents, nested])).toEqual([]);
  });

  it("recognizes commands and the other exclusive groups", () => {
    const root = "/repo";
    const parsed = file(root, "AGENTS.md", [
      "- Run `pnpm install` for dependencies.",
      "- Run `npm install` for deployment.",
      "- Use pytest for Python tests.",
      "- Prefer unittest for alternate tests.",
      "- Always use prettier for formatting.",
      "- Use biome for formatting source.",
      "- Prefer single quotes in source.",
      "- Use double quotes in tests.",
    ].join("\n"));
    const issues = conflicts(root, [parsed]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'Rules recommend both "pnpm" (AGENTS.md:1) and "npm" (AGENTS.md:2).',
      'Rules recommend both "pytest" (AGENTS.md:3) and "unittest" (AGENTS.md:4).',
      'Rules recommend both "prettier" (AGENTS.md:5) and "biome" (AGENTS.md:6).',
      'Rules recommend both "single quotes" (AGENTS.md:7) and "double quotes" (AGENTS.md:8).',
    ]);
  });
});
