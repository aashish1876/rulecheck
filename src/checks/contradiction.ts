import path from "node:path";
import type { Check, Issue, ParsedRulesFile, Rule } from "../types.js";
import { exclusiveGroups } from "./data/exclusive-groups.js";

const negativeDirective = /\b(?:never|avoid|don't|do not|must not|should not)(?:\s+use)?\s+/i;
const positiveDirective = /\b(?:always|must|use|prefer|should)(?:\s+use)?\s+/i;
const stopWords = new Set(["a", "an", "and", "are", "as", "be", "for", "from", "in", "is", "of", "on", "the", "to", "with"]);

interface Directive {
  polarity: "positive" | "negative";
  subject: Set<string>;
}

interface LocatedRule {
  file: ParsedRulesFile;
  rule: Rule;
}

function words(value: string): string[] {
  return value.toLowerCase().replace(/[`*_~>#]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((word) => word && !stopWords.has(word));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

function directive(text: string): Directive | undefined {
  const negative = negativeDirective.exec(text);
  const positive = positiveDirective.exec(text);
  if (negative && positive && positive.index >= negative.index + negative[0].length) return undefined;
  const match = negative ?? positive;
  if (!match) return undefined;
  const polarity = negative ? "negative" : "positive";
  const subject = new Set(words(text.slice(match.index + match[0].length)));
  return subject.size ? { polarity, subject } : undefined;
}

function fileDirectory(root: string, file: string): string {
  return path.relative(root, path.dirname(file));
}

function sameHeadingScope(left: Rule, right: Rule): boolean {
  const a = left.parentHeading?.trim().toLowerCase() ?? "";
  const b = right.parentHeading?.trim().toLowerCase() ?? "";
  return a === b;
}

function relativeLocation(root: string, file: string, line: number): string {
  return `${path.relative(root, file) || path.basename(file)}:${line}`;
}

function opposedDirectiveIssues(root: string, files: ParsedRulesFile[]): Issue[] {
  const rules: LocatedRule[] = files.flatMap((file) => file.rules.map((rule) => ({ file, rule })));
  const issues: Issue[] = [];
  for (let laterIndex = 1; laterIndex < rules.length; laterIndex += 1) {
    const later = rules[laterIndex];
    if (!later) continue;
    const laterDirective = directive(later.rule.text);
    if (!laterDirective) continue;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = rules[earlierIndex];
      if (!earlier || fileDirectory(root, earlier.file.path) !== fileDirectory(root, later.file.path)) continue;
      if (!sameHeadingScope(earlier.rule, later.rule)) continue;
      const earlierDirective = directive(earlier.rule.text);
      if (!earlierDirective || earlierDirective.polarity === laterDirective.polarity) continue;
      if (jaccard(earlierDirective.subject, laterDirective.subject) < 0.6) continue;
      const first = relativeLocation(root, earlier.file.path, earlier.rule.line);
      const second = relativeLocation(root, later.file.path, later.rule.line);
      issues.push({
        ruleId: "contradiction",
        severity: "error",
        message: `Conflicting directives: ${first} and ${second} recommend opposite actions for a similar subject.`,
        file: later.file.path,
        line: later.rule.line,
      });
      break;
    }
  }
  return issues;
}

function directiveKinds(text: string): { positive: boolean; negative: boolean } {
  const negative = negativeDirective.exec(text);
  const positive = positiveDirective.exec(text);
  return {
    negative: Boolean(negative),
    positive: Boolean(positive && (!negative || positive.index >= negative.index + negative[0].length)),
  };
}

function languageHint(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\b(python|pytest|unittest|nose|black)\b/.test(lower)) return "python";
  if (/\b(javascript|typescript|node|jest|vitest|mocha|prettier|biome)\b/.test(lower)) return "javascript";
  return undefined;
}

function directoryHint(text: string): string | undefined {
  const match = /\b(frontend|backend|client|server|web|api|src|tests?|packages?\/[^\s`.,;]+)/i.exec(text);
  return match?.[1]?.toLowerCase();
}

function choicesFor(text: string, groupIndex: number): string[] {
  const group = exclusiveGroups[groupIndex];
  if (!group) return [];
  return group.choices.filter(({ pattern }) => pattern.test(text)).map(({ value }) => value);
}

function choiceIssues(root: string, files: ParsedRulesFile[]): Issue[] {
  const rules: LocatedRule[] = files.flatMap((file) => file.rules.map((rule) => ({ file, rule })));
  const issues: Issue[] = [];
  for (let laterIndex = 1; laterIndex < rules.length; laterIndex += 1) {
    const later = rules[laterIndex];
    if (!later) continue;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = rules[earlierIndex];
      if (!earlier) continue;
      const sameFile = earlier.file.path === later.file.path;
      const rootFiles = path.dirname(earlier.file.path) === root && path.dirname(later.file.path) === root;
      if (!sameFile && !rootFiles) continue;
      if (!sameHeadingScope(earlier.rule, later.rule)) continue;
      const earlierHints = [languageHint(earlier.rule.text), directoryHint(earlier.rule.text)];
      const laterHints = [languageHint(later.rule.text), directoryHint(later.rule.text)];
      if (earlierHints.some((hint, index) => hint && laterHints[index] && hint !== laterHints[index])) continue;
      const earlierKinds = directiveKinds(earlier.rule.text);
      const laterKinds = directiveKinds(later.rule.text);
      if (earlierKinds.negative && earlierKinds.positive || laterKinds.negative && laterKinds.positive) continue;

      for (let groupIndex = 0; groupIndex < exclusiveGroups.length; groupIndex += 1) {
        const leftChoices = choicesFor(earlier.rule.text, groupIndex);
        const rightChoices = choicesFor(later.rule.text, groupIndex);
        if (leftChoices.length !== 1 || rightChoices.length !== 1 || leftChoices[0] === rightChoices[0]) continue;
        if (!earlierKinds.positive || !laterKinds.positive) continue;
        const left = leftChoices[0];
        const right = rightChoices[0];
        if (!left || !right) continue;
        const first = relativeLocation(root, earlier.file.path, earlier.rule.line);
        const second = relativeLocation(root, later.file.path, later.rule.line);
        issues.push({
          ruleId: "contradiction",
          severity: "warning",
          message: `Rules recommend both "${left}" (${first}) and "${right}" (${second}).`,
          file: later.file.path,
          line: later.rule.line,
        });
      }
    }
  }
  return issues;
}

export const contradictionCheck: Check = {
  id: "contradiction",
  description: "Find opposing directives and conflicting tool recommendations.",
  run: (ctx) => [...opposedDirectiveIssues(ctx.root, ctx.files), ...choiceIssues(ctx.root, ctx.files)],
};
