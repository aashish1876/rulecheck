import path from "node:path";
import type { ScoreResult } from "../score.js";
import type { Issue, ParsedRulesFile } from "../types.js";

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function relativeFile(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)) || path.basename(file);
}

export function formatMarkdown(
  root: string,
  files: ParsedRulesFile[],
  issues: Issue[],
  result: ScoreResult | null,
  verbose = false,
): string {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const visible = issues.filter((issue) => issue.severity !== "info" || verbose);
  const heading = result ? `## rulecheck: ${result.score}/100 (${result.grade})` : "## rulecheck: no rules files found";
  const ruleCount = files.reduce((sum, file) => sum + file.rules.length, 0);
  const lines = [
    "<!-- rulecheck-report -->",
    heading,
    `Files: ${files.length} · Rules: ${ruleCount} · Errors: ${errors} · Warnings: ${warnings}`,
    "",
  ];
  if (errors + warnings === 0) {
    lines.push("No problems found.");
  } else {
    lines.push("| File | Line | Severity | Rule | Message |", "| --- | ---: | --- | --- | --- |");
    const shown = visible.slice(0, 50);
    for (const issue of shown) {
      lines.push(`| ${cell(relativeFile(root, issue.file))} | ${issue.line} | ${issue.severity} | ${cell(issue.ruleId)} | ${cell(issue.message)} |`);
    }
    const remaining = visible.length - shown.length;
    if (remaining > 0) lines.push("", `...and ${remaining} more`);
  }
  return lines.join("\n");
}
