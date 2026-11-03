import path from "node:path";
import type { Check, Issue, ParsedRulesFile, Rule } from "../types.js";

const stopWords = new Set(["a", "an", "the", "to", "of", "in", "for", "and", "or", "is", "are", "be", "it", "this", "that", "with", "on"]);

interface LocatedRule {
  file: ParsedRulesFile;
  rule: Rule;
  tokens: Set<string>;
  normalized: string;
}

export function normalizeRule(text: string): string[] {
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  return plain.split(/\s+/).filter((word) => word && !stopWords.has(word));
}

function similarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

function location(root: string, file: string, line: number): string {
  return `${path.relative(root, file) || path.basename(file)}:${line}`;
}

function locateRules(files: ParsedRulesFile[]): LocatedRule[] {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap((file) => [...file.rules].sort((a, b) => a.line - b.line).map((rule) => {
      const words = normalizeRule(rule.text);
      return { file, rule, tokens: new Set(words), normalized: words.join(" ") };
    }).filter((entry) => entry.tokens.size >= 4));
}

export const duplicateRuleCheck: Check = {
  id: "duplicate-rule",
  description: "Find repeated or very similar instructions.",
  run: (ctx) => {
    const located = locateRules(ctx.files);
    const issues: Issue[] = [];
    for (let laterIndex = 1; laterIndex < located.length; laterIndex += 1) {
      const later = located[laterIndex];
      if (!later) continue;
      for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
        const earlier = located[earlierIndex];
        if (!earlier) continue;
        const exact = later.normalized === earlier.normalized;
        const score = similarity(later.tokens, earlier.tokens);
        if (!exact && score < 0.8) continue;
        const original = location(ctx.root, earlier.file.path, earlier.rule.line);
        const severity = exact ? "warning" : "info";
        issues.push({
          ruleId: "duplicate-rule",
          severity,
          message: `${exact ? "Duplicate" : "Near-duplicate"} of rule at ${original}`,
          file: later.file.path,
          line: later.rule.line,
          suggestion: "Remove one of them.",
        });
        break;
      }
    }
    return issues;
  },
};
