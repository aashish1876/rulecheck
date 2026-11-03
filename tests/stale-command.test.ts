import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRules } from "../src/parse.js";
import { duplicateRuleCheck } from "../src/checks/duplicate-rule.js";
import { staleCommandCheck } from "../src/checks/stale-command.js";
import type { ParsedRulesFile } from "../src/types.js";

const root = path.resolve("tests/fixtures/realworld-commands-repo");

function loadRules(fileName: string): ParsedRulesFile {
  const filePath = path.join(root, fileName);
  const content = readFileSync(filePath, "utf8");
  return { path: filePath, type: fileName === "AGENTS.md" ? "agents" : "claude", ...parseRules(content), content };
}

describe("stale-command precision", () => {
  it("skips built-ins, scoped commands, nested scripts, makefiles, artifacts, and symlink aliases", () => {
    const agents = loadRules("AGENTS.md");
    const claude = loadRules("CLAUDE.md");
    expect(agents.commands.map((command) => command.value)).toEqual(expect.arrayContaining([
      "pnpm add lodash", "pnpm install", "pnpm prettier", "pnpm --filter x run test",
      "cd frontend && npm run build", "pnpm run nested-only", "make second-target", "./target/debug/deno",
    ]));
    expect(staleCommandCheck.run({ root, files: [agents, claude] })).toEqual([]);
    expect(duplicateRuleCheck.run({ root, files: [agents, claude] })).toEqual([]);
  });
});
