import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
});
