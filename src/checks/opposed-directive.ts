import path from "node:path";
import type { Check, Issue, ParsedRulesFile, Rule } from "../types.js";

export type DirectivePolarity = "positive" | "negative";

interface ExtractedDirective {
  polarity: DirectivePolarity;
  subject: Set<string>;
}

interface LocatedDirective {
  file: ParsedRulesFile;
  rule: Rule;
  polarity: DirectivePolarity;
  subject: Set<string>;
}

const positiveWords = new Set(["always", "must", "should", "use", "prefer", "ensure"]);
const negativeWords = new Set(["never", "avoid", "no"]);
const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with", "not",
  "always", "must", "should", "use", "prefer", "ensure", "never", "avoid", "no", "do", "dont", "does", "when", "if", "unless", "except", "only",
  "file", "code", "function", "test", "change", "add",
]);
const conditionalRule = /\b(?:when|if|unless|except|only\s+in)\b/i;
const migrationNote = /\b(?:instead\s+of|rather\s+than)\b/i;
const directivePhrase = /\b(?:must\s+not|should\s+not|do\s+not|don't|never|avoid|no|always|must|should|use|prefer|ensure)\b/i;

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[`*_~>#]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !stopWords.has(word));
}

export function extractDirective(text: string): ExtractedDirective | undefined {
  if (conditionalRule.test(text) || migrationNote.test(text)) return undefined;
  const phrase = directivePhrase.exec(text);
  if (!phrase) return undefined;

  const lower = text.toLowerCase();
  const hasNegative = /\b(?:never|do\s+not|don't|must\s+not|should\s+not|avoid|no)\b/i.test(lower);
  const withoutNegativePhrases = lower.replace(/\b(?:must\s+not|should\s+not|do\s+not|don't|never|avoid|no)(?:\s+use)?\b/g, " ");
  const hasPositive = /\b(?:always|must|should|use|prefer|ensure)\b/i.test(withoutNegativePhrases);
  if (hasNegative && hasPositive) return undefined;

  const negative = /^(?:never|avoid|no|don't|do\s+not|must\s+not|should\s+not)$/i.test(phrase[0].replace(/\s+/g, " "));
  const after = text.slice(phrase.index + phrase[0].length);
  const subject = new Set(normalizeWords(after));
  return subject.size ? { polarity: negative ? "negative" : "positive", subject } : undefined;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

function quoteRule(text: string): string {
  return text.trim().split(/\s+/).slice(0, 8).join(" ");
}

function sameHeading(left: Rule, right: Rule): boolean {
  return (left.parentHeading?.trim().toLowerCase() ?? "") === (right.parentHeading?.trim().toLowerCase() ?? "");
}

function allowedFilePair(root: string, left: ParsedRulesFile, right: ParsedRulesFile): boolean {
  if (left.path === right.path) return true;
  return path.dirname(path.resolve(left.path)) === root && path.dirname(path.resolve(right.path)) === root;
}

function narrowScope(text: string): boolean {
  return /\.[A-Za-z0-9]{1,5}\b|\b(?:specific|particular|legacy|generated|case|folder|directory)\b|(?:^|\s)[\w.-]+\/[\w./-]+/i.test(text);
}

function locateRules(files: ParsedRulesFile[]): LocatedDirective[] {
  return files.flatMap((file) => file.rules.map((rule) => {
    const directive = extractDirective(rule.text);
    return directive ? { file, rule, ...directive } : undefined;
  }).filter((value): value is LocatedDirective => Boolean(value)))
    .sort((left, right) => left.file.path.localeCompare(right.file.path) || left.rule.line - right.rule.line);
}

function buildIssues(root: string, files: ParsedRulesFile[]): Issue[] {
  const located = locateRules(files);
  const issues: Issue[] = [];
  for (let laterIndex = 1; laterIndex < located.length; laterIndex += 1) {
    const later = located[laterIndex];
    if (!later) continue;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = located[earlierIndex];
      if (!earlier || earlier.polarity === later.polarity) continue;
      if (earlier.subject.size < 2 || later.subject.size < 2 || jaccard(earlier.subject, later.subject) < 0.7) continue;
      if (narrowScope(earlier.rule.text) !== narrowScope(later.rule.text)) continue;
      if (!allowedFilePair(root, earlier.file, later.file) || !sameHeading(earlier.rule, later.rule)) continue;
      const source = path.relative(root, earlier.file.path) || path.basename(earlier.file.path);
      issues.push({
        ruleId: "opposed-directive",
        severity: "warning",
        message: `This rule conflicts with ${source}:${earlier.rule.line} ("${quoteRule(earlier.rule.text)}").`,
        file: later.file.path,
        line: later.rule.line,
      });
      break;
    }
  }
  return issues;
}

export const opposedDirectiveCheck: Check = {
  id: "opposed-directive",
  description: "Find rules with opposite instructions about the same subject.",
  run: (ctx) => buildIssues(path.resolve(ctx.root), ctx.files),
};
