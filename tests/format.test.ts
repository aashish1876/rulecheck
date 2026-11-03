import { describe, expect, it } from "vitest";
import { formatGithub } from "../src/format/github.js";
import { formatMarkdown } from "../src/format/markdown.js";
import { badgeSvg } from "../src/badge.js";
import type { Issue, ParsedRulesFile } from "../src/types.js";
import type { ScoreResult } from "../src/score.js";

const score: ScoreResult = { score: 46, grade: "Poor", breakdown: [] };

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    ruleId: "stale-path",
    severity: "error",
    message: "Path is missing",
    file: "/repo/AGENTS.md",
    line: 4,
    ...overrides,
  };
}

describe("github formatter", () => {
  it("escapes annotation properties and message data", () => {
    const found = issue({
      file: "/repo/dir,one/rules:%file.md",
      message: "bad % value\r\nnext",
      ruleId: "check:title,part",
    });
    expect(formatGithub("/repo", [found], score)).toBe(
      "::error file=dir%2Cone/rules%3A%25file.md,line=4,title=check%3Atitle%2Cpart::bad %25 value%0D%0Anext\nScore: 46/100 (Poor)",
    );
  });

  it("prints info as notices only in verbose mode", () => {
    const info = issue({ severity: "info", message: "FYI" });
    expect(formatGithub("/repo", [info], score)).toBe("Score: 46/100 (Poor)");
    expect(formatGithub("/repo", [info], score, true)).toContain("::notice file=AGENTS.md,line=4,title=stale-path::FYI");
  });
});

describe("markdown formatter", () => {
  const files: ParsedRulesFile[] = [{
    path: "/repo/AGENTS.md", type: "agents", headings: [], rules: [], filePaths: [], commands: [],
  }];

  it("prints marker, heading, summary, and a pipe-escaped issue table", () => {
    const report = formatMarkdown("/repo", files, [issue({ message: "Use x | y" })], score);
    expect(report.split("\n")[0]).toBe("<!-- rulecheck-report -->");
    expect(report).toContain("## rulecheck: 46/100 (Poor)");
    expect(report).toContain("Files: 1 · Rules: 0 · Errors: 1 · Warnings: 0");
    expect(report).toContain("| AGENTS.md | 4 | error | stale-path | Use x \\| y |");
  });

  it("caps tables at 50 rows and reports remaining findings", () => {
    const many = Array.from({ length: 54 }, (_, index) => issue({ line: index + 1, message: `Problem ${index + 1}` }));
    const report = formatMarkdown("/repo", files, many, score);
    expect(report.match(/^\| AGENTS\.md \|/gm)).toHaveLength(50);
    expect(report).toContain("...and 4 more");
  });

  it("prints the clean result message when no problems exist", () => {
    expect(formatMarkdown("/repo", files, [], { ...score, score: 100, grade: "Excellent" })).toContain("No problems found.");
  });
});

describe("badgeSvg", () => {
  const colors = new Map([[49, "#d1453b"], [50, "#d29922"], [74, "#d29922"], [75, "#a3c01f"], [89, "#a3c01f"], [90, "#3fb950"]]);

  it("uses the specified color at each score boundary and includes accessible score text", () => {
    for (const [value, color] of colors) {
      const svg = badgeSvg(value);
      expect(svg).toContain(`fill="${color}"`);
      expect(svg).toContain(`>${value}/100</text>`);
      expect(svg).toContain(`aria-label="rulecheck score ${value} out of 100"`);
      expect(svg).toContain(`<title>rulecheck score ${value} out of 100</title>`);
      expect(isWellFormedSvg(svg)).toBe(true);
    }
  });
});

function isWellFormedSvg(svg: string): boolean {
  const tags = svg.match(/<[^>]+>/g) ?? [];
  const stack: string[] = [];
  let cursor = 0;
  for (const tag of tags) {
    const start = svg.indexOf(tag, cursor);
    if (start < 0 || /[<>]/.test(svg.slice(cursor, start))) return false;
    cursor = start + tag.length;
    const name = /^<\/?([A-Za-z][\w:-]*)/.exec(tag)?.[1];
    if (!name) return false;
    if (tag.startsWith("</")) {
      if (stack.pop() !== name) return false;
    } else if (!tag.endsWith("/>")) {
      stack.push(name);
    }
  }
  return stack.length === 0 && svg.slice(cursor).trim() === "";
}
