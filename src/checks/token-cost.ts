import path from "node:path";
import type { Check, Issue, ParsedRulesFile } from "../types.js";

export const tokenThresholds = { warning: 5_000 } as const;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function largestSection(file: ParsedRulesFile): { title: string; tokens: number } | undefined {
  const content = file.content ?? "";
  const headings = file.headings.filter((heading) => heading.depth >= 2);
  if (!content || headings.length === 0) return undefined;
  const lines = content.split("\n");
  const sections = headings.map((heading) => {
    const next = file.headings.find((candidate) => candidate.line > heading.line && candidate.depth <= heading.depth);
    const endLine = next?.line ?? lines.length + 1;
    const sectionText = lines.slice(heading.line - 1, endLine - 1).join("\n");
    return { title: heading.text, tokens: estimateTokens(sectionText) };
  });
  return sections.sort((a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title))[0];
}

function issue(file: string, line: number, severity: Issue["severity"], message: string): Issue {
  return { ruleId: "token-cost", severity, message, file, line };
}

function fileIssues(file: ParsedRulesFile): Issue[] {
  const content = file.content ?? "";
  const tokens = estimateTokens(content);
  const result = [issue(file.path, 1, "info", `Estimated size: ~${tokens.toLocaleString("en-US")} tokens.`)];
  if (tokens >= tokenThresholds.warning) {
    const section = largestSection(file);
    const suffix = section ? ` Largest section: "${section.title}" (~${section.tokens.toLocaleString("en-US")} tokens).` : "";
    result.push(issue(file.path, 1, "warning", `Estimated size: ~${tokens.toLocaleString("en-US")} tokens, above ${tokenThresholds.warning.toLocaleString("en-US")} tokens.${suffix}`));
  }
  return result;
}

function rootFiles(root: string, files: ParsedRulesFile[]): ParsedRulesFile[] {
  return files.filter((file) => path.dirname(path.resolve(file.path)) === path.resolve(root));
}

export const tokenCostCheck: Check = {
  id: "token-cost",
  description: "Estimate the prompt token cost of rules files.",
  run: (ctx) => {
    const issues = ctx.files.flatMap(fileIssues);
    const rootLevel = rootFiles(ctx.root, ctx.files);
    if (rootLevel.length >= 2) {
      const combined = rootLevel.reduce((total, file) => total + estimateTokens(file.content ?? ""), 0);
      const owner = rootLevel[0];
      if (owner) issues.push(issue(owner.path, 1, "info", `Combined estimate for root-level rules files: ~${combined.toLocaleString("en-US")} tokens.`));
    }
    return issues;
  },
};
