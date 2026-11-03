import path from "node:path";
import type { Issue } from "../types.js";
import type { ScoreResult } from "../score.js";

export function escapeGithubMessage(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function escapeGithubProperty(value: string): string {
  return escapeGithubMessage(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function formatGithub(root: string, issues: Issue[], result: ScoreResult | null, verbose = false): string {
  if (result === null) return "No rules files found.";
  const lines = issues
    .filter((issue) => issue.severity !== "info" || verbose)
    .map((issue) => {
      const command = issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "notice";
      const file = escapeGithubProperty(path.relative(root, path.resolve(root, issue.file)) || path.basename(issue.file));
      const title = escapeGithubProperty(issue.ruleId);
      return `::${command} file=${file},line=${issue.line},title=${title}::${escapeGithubMessage(issue.message)}`;
    });
  lines.push(`Score: ${result.score}/100 (${result.grade})`);
  return lines.join("\n");
}
