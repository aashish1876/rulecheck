import { describe, expect, it } from "vitest";
import { isBuildArtifactPath, isPlaceholder, isUserCreatedConfigPath } from "../src/checks/shared.js";

describe("shared path precision helpers", () => {
  it("recognizes placeholder path segments after removing extensions", () => {
    for (const value of [
      "dev/my_script.py", "./pkg/services/myservice/", "tests/specs/my_feature/",
      "site/docs/_partial-some-content.mdx", "foo/bar.ts", "sample/data.json",
    ]) expect(isPlaceholder(value)).toBe(true);
  });

  it("skips illustrative or optional path contexts", () => {
    for (const context of [
      "e.g. `src/missing.ts`", "for example `src/missing.ts`", "such as `src/missing.ts`",
      "create `src/missing.ts`", "generates `src/missing.ts`", "copy `src/missing.ts`",
      "your own `src/missing.ts`", "may use `src/missing.ts`", "might use `src/missing.ts`",
      "if exists `src/missing.ts`", "if present `src/missing.ts`", "if any `src/missing.ts`",
      "(if needed) `src/missing.ts`", "installed package `src/missing.ts`", "node_modules path",
      "inside that directory", "locally", "gitignored", "optional template",
    ]) expect(isPlaceholder("src/missing.ts", context)).toBe(true);
  });

  it("recognizes generated paths and user-created config names", () => {
    for (const value of ["dev/registry/.inventory_cache/", "src/generated/schema.ts", "tmp/output.json", "artifacts/report.txt"]) {
      expect(isBuildArtifactPath(value)).toBe(true);
    }
    for (const value of ["conf/custom.ini", "conf/local.yml", "conf/app.local.json", ".env.production"]) {
      expect(isUserCreatedConfigPath(value)).toBe(true);
    }
  });
});
