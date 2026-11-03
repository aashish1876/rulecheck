import { describe, expect, it } from "vitest";
import path from "node:path";
import { discoverRulesFiles } from "../src/discover.js";

const fixture = path.resolve("tests/fixtures/sample-repo");

describe("discoverRulesFiles", () => {
  it("finds supported files and classifies them", async () => {
    const files = await discoverRulesFiles(fixture);
    expect(files.map((file) => [path.relative(fixture, file.path), file.type])).toEqual([
      ["AGENTS.md", "agents"],
      ["CLAUDE.md", "claude"],
    ]);
  });

  it("finds nested and special files while ignoring generated directories", async () => {
    const root = path.resolve("tests/fixtures/discovery-repo");
    const files = await discoverRulesFiles(root);
    expect(files.map((file) => [path.relative(root, file.path), file.type])).toEqual([
      [".cursor/rules/style.mdc", "cursor-mdc"],
      [".cursorrules", "cursorrules"],
      [".github/copilot-instructions.md", "copilot"],
      ["AGENTS.md", "agents"],
      ["packages/app/CLAUDE.md", "claude"],
    ]);
  });

  it("adds repeatable ignore globs to the default exclusions", async () => {
    const root = path.resolve("tests/fixtures/discovery-repo");
    const files = await discoverRulesFiles(root, ["packages/**"]);
    expect(files.map((file) => path.relative(root, file.path))).not.toContain("packages/app/CLAUDE.md");
    expect(files.map((file) => path.relative(root, file.path))).toContain("AGENTS.md");
  });
});
