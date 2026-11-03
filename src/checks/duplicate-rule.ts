import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Check, Issue, ParsedRulesFile, Rule } from "../types.js";

const stopWords = new Set(["a", "an", "the", "to", "of", "in", "for", "and", "or", "is", "are", "be", "it", "this", "that", "with", "on"]);

interface LocatedRule {
  file: ParsedRulesFile;
  rule: Rule;
  tokens: Set<string>;
  normalized: string;
}

function canonicalPath(file: ParsedRulesFile): string {
  try {
    return realpathSync(file.path);
  } catch {
    return path.resolve(file.path);
  }
}

function uniqueFiles(files: ParsedRulesFile[]): ParsedRulesFile[] {
  const seen = new Set<string>();
  return [...files].sort((a, b) => a.path.localeCompare(b.path)).filter((file) => {
    const canonical = canonicalPath(file);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function contentKey(file: ParsedRulesFile): string | undefined {
  try {
    return readFileSync(file.path).toString("base64");
  } catch {
    return file.content === undefined ? undefined : Buffer.from(file.content).toString("base64");
  }
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
  return files.flatMap((file) => [...file.rules].sort((a, b) => a.line - b.line).map((rule) => {
    const words = normalizeRule(rule.text);
    return { file, rule, tokens: new Set(words), normalized: words.join(" ") };
  }).filter((entry) => entry.tokens.size >= 4));
}

function sameDirectory(left: ParsedRulesFile, right: ParsedRulesFile): boolean {
  return path.dirname(path.resolve(left.path)) === path.dirname(path.resolve(right.path));
}

function ruleIssue(root: string, later: LocatedRule, earlier: LocatedRule, sameFile: boolean): Issue | undefined {
  const exact = later.normalized === earlier.normalized;
  if (!exact && similarity(later.tokens, earlier.tokens) < 0.8) return undefined;
  return {
    ruleId: "duplicate-rule",
    severity: sameFile ? "warning" : "info",
    message: `${exact ? "Duplicate" : "Near-duplicate"} of rule at ${location(root, earlier.file.path, earlier.rule.line)}`,
    file: later.file.path,
    line: later.rule.line,
    suggestion: "Remove one of them.",
  };
}

export const duplicateRuleCheck: Check = {
  id: "duplicate-rule",
  description: "Find repeated or very similar instructions.",
  run: (ctx) => {
    const files = uniqueFiles(ctx.files);
    const contentKeys = new Map(files.map((file) => [file, contentKey(file)]));
    const identicalPairs = new Set<string>();
    const issues: Issue[] = [];

    for (let laterIndex = 1; laterIndex < files.length; laterIndex += 1) {
      const later = files[laterIndex];
      if (!later) continue;
      for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
        const earlier = files[earlierIndex];
        if (!earlier || !sameDirectory(earlier, later)) continue;
        const laterContent = contentKeys.get(later);
        if (laterContent === undefined || laterContent !== contentKeys.get(earlier)) continue;
        const pair = `${earlierIndex}:${laterIndex}`;
        identicalPairs.add(pair);
        if (!identicalPairs.has(`reported:${laterIndex}`)) {
          issues.push({
            ruleId: "duplicate-rule", severity: "info",
            message: `${path.basename(later.path)} is identical to ${path.basename(earlier.path)}`,
            file: later.path, line: 1,
          });
          identicalPairs.add(`reported:${laterIndex}`);
        }
      }
    }

    const located = locateRules(files);
    for (let laterIndex = 1; laterIndex < located.length; laterIndex += 1) {
      const later = located[laterIndex];
      if (!later) continue;
      for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
        const earlier = located[earlierIndex];
        if (!earlier) continue;
        const sameFile = canonicalPath(later.file) === canonicalPath(earlier.file);
        if (!sameFile && !sameDirectory(later.file, earlier.file)) continue;
        const laterFileIndex = files.indexOf(later.file);
        const earlierFileIndex = files.indexOf(earlier.file);
        if (!sameFile && identicalPairs.has(`${Math.min(laterFileIndex, earlierFileIndex)}:${Math.max(laterFileIndex, earlierFileIndex)}`)) continue;
        const issue = ruleIssue(ctx.root, later, earlier, sameFile);
        if (issue) {
          issues.push(issue);
          break;
        }
      }
    }
    return issues;
  },
};
