import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");
const fixtures = path.resolve("tests/fixtures");

describe("built CLI", () => {
  it("reports stale fixture problems and exits unsuccessfully", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "stale-repo")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("stale-path");
    expect(result.stdout).toContain("stale-command");
  });

  it("reports a clean fixture and exits successfully", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo")], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No problems found.");
    expect(result.stdout).not.toContain("Estimated size:");
  });

  it("supports repeated --ignore options and prints line numbers without columns", () => {
    const root = path.resolve("tests/fixtures/discovery-repo");
    const result = spawnSync(process.execPath, [cli, root, "--ignore", "packages/**", "--ignore", "AGENTS.md"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("packages/app/CLAUDE.md");
    expect(result.stdout).not.toMatch(/\b\d+:\d+\s/);
  });

  it("shows informational findings with --verbose while still reporting no problems", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--verbose"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Estimated size:");
    expect(result.stdout).toContain("No problems found.");
    expect(result.stdout).toContain("Penalty breakdown:");
    expect(result.stdout).toContain("token-cost: 0 errors, 0 warnings, 0 penalty");
    expect(result.stdout).not.toContain("problems (0 errors, 0 warnings)");
  });

  it("reports planted duplicate rules in the dupes fixture only", () => {
    const fixture = path.resolve("tests/fixtures/dupes-repo");
    const result = spawnSync(process.execPath, [cli, fixture, "--verbose"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Duplicate of rule at AGENTS.md:3");
    expect(result.stdout).toContain("Near-duplicate of rule at AGENTS.md:3");
    expect(result.stdout).toContain("Duplicate of rule at AGENTS.md:5");
    expect(result.stdout).not.toContain("npm test after");
    expect(result.stdout).not.toContain("cache invalidation");
    expect(result.stdout).not.toContain("Keep this brief");
  });

  it("aligns severity messages and separates the discovery header", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "stale-repo")], { encoding: "utf8" });
    const lines = result.stdout.split("\n");
    const errorLine = lines.find((line) => line.includes("Path \"src/utlis/\"")) ?? "";
    const warningLine = lines.find((line) => line.includes("This repository uses pnpm")) ?? "";
    expect(errorLine.indexOf("Path ")).toBe(warningLine.indexOf("This repository"));
    expect(result.stdout).toContain("\nFound ");
  });

  it("prints parseable JSON only, including info issues and score fields", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--format", "json"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      version: string; score: number; grade: string;
      summary: { files: number; rules: number; errors: number; warnings: number; infos: number };
      files: Array<{ path: string; type: string }>;
      issues: Array<{ ruleId: string; severity: string; file: string; line: number }>;
      breakdown: Array<{ ruleId: string; errors: number; warnings: number; penalty: number }>;
    };
    expect(parsed).toMatchObject({ version: "0.0.1", score: 100, grade: "Excellent" });
    expect(parsed.summary).toMatchObject({ files: 1, errors: 0, warnings: 0 });
    expect(parsed.summary.infos).toBeGreaterThan(0);
    expect(parsed.files[0]).toMatchObject({ path: "AGENTS.md", type: "agents" });
    expect(parsed.issues.some((issue) => issue.severity === "info")).toBe(true);
    expect(Array.isArray(parsed.breakdown)).toBe(true);
  });

  it("returns JSON with a null score when discovery finds no rules files", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--ignore", "**/*.md", "--format", "json"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No rules files found.");
    expect(JSON.parse(result.stdout)).toMatchObject({ score: null, grade: null, summary: { files: 0 }, files: [], issues: [] });
  });

  it("uses exit codes 0, 1, and 2 for success, findings, and a bad directory", () => {
    const clean = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo")], { encoding: "utf8" });
    const stale = spawnSync(process.execPath, [cli, path.join(fixtures, "stale-repo")], { encoding: "utf8" });
    const missing = spawnSync(process.execPath, [cli, path.join(fixtures, "no-such-repo")], { encoding: "utf8" });
    expect(clean.status).toBe(0);
    expect(stale.status).toBe(1);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("Not a readable directory");
    expect(missing.stderr).not.toContain("at file:");
  });

  it("applies warning and score thresholds", () => {
    const warnings = spawnSync(process.execPath, [cli, path.resolve("tests/fixtures/dupes-repo"), "--max-warnings", "0"], { encoding: "utf8" });
    const scoreThreshold = spawnSync(process.execPath, [cli, path.join(fixtures, "stale-repo"), "--min-score", "80"], { encoding: "utf8" });
    const cleanThreshold = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--min-score", "100"], { encoding: "utf8" });
    expect(warnings.status).toBe(1);
    expect(scoreThreshold.status).toBe(1);
    expect(cleanThreshold.status).toBe(0);
  });

  it("rejects invalid formats and disables color with --no-color", () => {
    const invalid = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--format", "yaml"], { encoding: "utf8" });
    const plain = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--no-color"], {
      encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1" },
    });
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("Allowed choices");
    expect(plain.status).toBe(0);
    expect(plain.stdout).not.toMatch(/\u001b\[[0-9;]*m/);
    const noColorEnv = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo")], {
      encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "1" },
    });
    expect(noColorEnv.stdout).not.toMatch(/\u001b\[[0-9;]*m/);
  });

  it("uses singular problem wording for a single finding", () => {
    const result = spawnSync(process.execPath, [cli, path.resolve("tests/fixtures/prose-repo")], { encoding: "utf8" });
    expect(result.stdout).toContain("1 problem (1 error, 0 warnings)");
    expect(result.stdout).toContain("Score: ");
  });

  it("prints GitHub annotations and gates info notices on --verbose", () => {
    const stale = spawnSync(process.execPath, [cli, path.join(fixtures, "stale-repo"), "--format", "github"], { encoding: "utf8" });
    const clean = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--format", "github"], { encoding: "utf8" });
    const verbose = spawnSync(process.execPath, [cli, path.join(fixtures, "clean-repo"), "--format", "github", "--verbose"], { encoding: "utf8" });
    expect(stale.stdout).toContain('::error file=AGENTS.md,line=4,title=stale-path::Path "src/utlis/" does not exist');
    expect(stale.stdout).toContain("::warning file=AGENTS.md");
    expect(stale.stdout).toContain("Score: ");
    expect(clean.stdout).not.toContain("::notice");
    expect(verbose.stdout).toContain("::notice");
  });

  it("prints a Markdown report with marker and score", () => {
    const result = spawnSync(process.execPath, [cli, path.join(fixtures, "stale-repo"), "--format", "markdown"], { encoding: "utf8" });
    expect(result.stdout.split("\n")[0]).toBe("<!-- rulecheck-report -->");
    expect(result.stdout).toContain("## rulecheck:");
    expect(result.stdout).toContain("| File | Line | Severity | Rule | Message |");
    expect(result.stderr).toBe("");
  });

  it("writes a badge SVG and handles no rules files without writing", () => {
    const temp = mkdtempSync(path.join(tmpdir(), "rulecheck-badge-"));
    const output = path.join(temp, "badge.svg");
    const none = path.join(temp, "no-rules.svg");
    try {
      const badge = spawnSync(process.execPath, [cli, "badge", path.join(fixtures, "clean-repo"), "--out", output], { encoding: "utf8" });
      expect(badge.status).toBe(0);
      expect(badge.stdout).toContain("![rulecheck](");
      expect(readFileSync(output, "utf8")).toContain("<svg");

      const empty = spawnSync(process.execPath, [cli, "badge", path.join(fixtures, "clean-repo"), "--ignore", "**/*.md", "--out", none], { encoding: "utf8" });
      expect(empty.status).toBe(0);
      expect(empty.stdout).toContain("No rules files found.");
      expect(existsSync(none)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
