import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseRules } from "../src/parse.js";

describe("parseRules", () => {
  it("extracts headings, nested rules, file paths, and commands with line numbers", async () => {
    const markdown = await readFile(path.resolve("tests/fixtures/sample-repo/AGENTS.md"), "utf8");
    const parsed = parseRules(markdown);
    expect(parsed.headings[0]).toMatchObject({ text: "Build rules", line: 1 });
    expect(parsed.rules.map((rule) => rule.text)).toEqual([
      "Run npm run test before submitting.",
      "Read src/utils/ and package.json for project conventions.",
      "Nested guidance:",
      "Run make build after changing source.",
    ]);
    expect(parsed.rules[2]?.parentHeading).toBe("Build rules");
    expect(parsed.filePaths.some((ref) => ref.value === "src/utils/")).toBe(true);
    expect(parsed.filePaths.some((ref) => ref.value.includes("example.com"))).toBe(false);
    expect(parsed.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "npm run build" }),
    ]));
    expect(parsed.commands.some((ref) => ref.value === "pytest")).toBe(false);
  });

  it("filters prose alternatives while retaining explicit path forms", () => {
    const root = path.resolve("tests/fixtures/clean-repo");
    const parsed = parseRules(
      "Prose: dark/light, 3D/Cinematic, primary/mono/outline, 16/9, 24/7, and/or, CI/CD, TCP/IP.\n" +
      "Use src/utils/ and package.json, then inspect `./scripts/build.sh` and `src/components/Hero.tsx`.",
      { root, filePath: path.join(root, "AGENTS.md") },
    );
    const values = parsed.filePaths.map((reference) => reference.value);
    for (const omitted of ["dark/light", "3D/Cinematic", "primary/mono/outline", "16/9", "24/7", "and/or", "CI/CD", "TCP/IP"]) {
      expect(values).not.toContain(omitted);
    }
    for (const retained of ["src/utils/", "package.json", "./scripts/build.sh", "src/components/Hero.tsx"]) {
      expect(values).toContain(retained);
    }
  });

  it("rejects dotted identifiers and non-allowlisted extensions, while extracting imports", () => {
    const parsed = parseRules("`console.log` `it.skip` `nodes.value.push` `excalidraw.com` `3.11` `0.2.1` `@AGENTS.md` `@scope/name`");
    const values = parsed.filePaths.map((reference) => reference.value);
    for (const omitted of ["console.log", "it.skip", "nodes.value.push", "excalidraw.com", "3.11", "0.2.1", "@scope/name"]) {
      expect(values).not.toContain(omitted);
    }
    expect(parsed.filePaths).toContainEqual(expect.objectContaining({ value: "AGENTS.md", isImport: true }));
  });

  it("maps prose references to their actual line", () => {
    const parsed = parseRules("Introductory prose begins here\nand mentions @.claude/CLAUDE.md on this line.");
    expect(parsed.filePaths).toContainEqual(expect.objectContaining({ value: ".claude/CLAUDE.md", line: 2, isImport: true }));
  });
});
