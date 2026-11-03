import path from "node:path";
import type { Check, Issue, ParsedRulesFile } from "../types.js";
import { toolConflictGroups, type ToolConflictGroup, type ToolConflictMember } from "./data/exclusive-groups.js";

interface Recommendation {
  file: ParsedRulesFile;
  group: ToolConflictGroup;
  member: ToolConflictMember;
  line: number;
  scope: Map<string, string>;
  ruleText: string;
  mentionStart: number;
}

const negativePattern = /\b(?:don't|do not|never|must not|should not|instead of|not|migrated from|replaces?|replacing|replaced)\b/i;
const comparisonPattern = /\b(?:compare|comparison|compared|versus|vs\.?|rather than|over|between\b.*\band)\b/i;
const positiveBefore = /\b(?:use|run|prefer|always|must)\b[^.!?;]{0,48}$/i;
const negativeAfter = /^\s*(?:is\s+)?(?:not\b|instead\b|replaced\b)/i;
const packageManagerNegation = /\b(?:do\s+not|don't|never|avoid)\b/i;

function aliasPattern(alias: string): RegExp {
  const words = alias.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${words}(?![\\p{L}\\p{N}_-])`, "giu");
}

function memberMatches(text: string, member: ToolConflictMember): Array<{ start: number; end: number }> {
  return member.aliases.flatMap((alias) => [...text.matchAll(aliasPattern(alias))].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  })));
}

function isNegated(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 60), start).split(/[.!?;,]/).at(-1) ?? "";
  const after = text.slice(end, end + 30);
  return negativePattern.test(before) || negativeAfter.test(after);
}

function isPositive(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 60), start).split(/[.!?;,]/).at(-1) ?? "";
  return positiveBefore.test(before);
}

function scopes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const lower = text.toLowerCase();
  const directory = /\b(frontend|backend|client|server|web|api)\b/.exec(lower)?.[1];
  const language = /\b(typescript|javascript|python)\b/.exec(lower)?.[1];
  const packageDirectory = /\b(?:packages|apps|src|tests?)\/([\w.-]+)/.exec(lower)?.[1];
  if (directory) result.set("directory", directory);
  if (language) result.set("language", language === "typescript" ? "javascript" : language);
  if (packageDirectory) result.set("packageDirectory", packageDirectory);
  return result;
}

function commandMember(command: string, group: ToolConflictGroup, member: ToolConflictMember): boolean {
  const value = command.trim().replace(/^\$\s*/, "").replace(/^cd\s+.+?\s*&&\s*/i, "");
  if (group.name === "package managers") {
    if (/^npx\b/i.test(value)) return false;
    const [executable, ...parts] = value.split(/\s+/);
    if (!member.aliases.includes(executable?.toLowerCase() ?? "")) return false;
    let index = 0;
    while (parts[index]?.startsWith("-")) {
      const flag = parts[index];
      index += 1;
      if (["--filter", "-F", "--workspace", "-w", "--prefix", "-C", "--cwd", "--dir"].includes(flag ?? "")) index += 1;
    }
    return ["install", "add", "ci", "run", "test", "start", "exec", "dlx", "create"].includes(parts[index]?.toLowerCase() ?? "");
  }
  for (const alias of member.aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const executable = new RegExp(`^(?:${escaped})(?=\\s|$)`, "i");
    const npxExecutable = new RegExp(`^npx\\s+(?:--yes\\s+)?${escaped}(?=\\s|$)`, "i");
    const pythonModule = new RegExp(`^python(?:3)?\\s+-m\\s+${escaped}(?=\\s|$)`, "i");
    if (executable.test(value) || (group.name !== "package managers" && (npxExecutable.test(value) || pythonModule.test(value)))) return true;
  }
  return false;
}

function ruleRecommendations(file: ParsedRulesFile, ruleText: string, line: number): Recommendation[] {
  const found: Recommendation[] = [];
  const scope = scopes(ruleText);
  for (const group of toolConflictGroups) {
    if (group.name === "package managers") continue;
    const allNames = group.members.filter((member) => memberMatches(ruleText, member).length > 0);
    if (allNames.length > 1 && comparisonPattern.test(ruleText)) continue;
    for (const member of group.members) {
      for (const match of memberMatches(ruleText, member)) {
        if (isNegated(ruleText, match.start, match.end) || !isPositive(ruleText, match.start)) continue;
        found.push({ file, group, member, line, scope, ruleText, mentionStart: match.start });
      }
    }
  }
  return found;
}

function commandRecommendations(file: ParsedRulesFile, command: { value: string; line: number }): Recommendation[] {
  const rule = file.rules.find((candidate) => candidate.line === command.line);
  const found: Recommendation[] = [];
  for (const group of toolConflictGroups) {
    if (group.name === "package managers" && packageManagerNegation.test(rule?.text ?? command.value)) continue;
    if (rule) {
      const mentions = group.members.filter((member) => memberMatches(rule.text, member).length > 0);
      if (mentions.length > 1 && comparisonPattern.test(rule.text)) continue;
    }
    for (const member of group.members) {
      if (commandMember(command.value, group, member)) {
        const aliasIndex = member.aliases.map((alias) => command.value.toLowerCase().indexOf(alias.toLowerCase())).find((index) => index >= 0) ?? 0;
        found.push({ file, group, member, line: command.line, scope: rule ? scopes(rule.text) : new Map(), ruleText: rule?.text ?? command.value, mentionStart: aliasIndex });
      }
    }
  }
  return found;
}

function collectRecommendations(file: ParsedRulesFile): Recommendation[] {
  const recommendations = file.rules.flatMap((rule) => ruleRecommendations(file, rule.text, rule.line));
  recommendations.push(...file.commands.flatMap((command) => commandRecommendations(file, command)));
  const seen = new Set<string>();
  return recommendations.filter((recommendation) => {
    const key = `${recommendation.group.name}\0${recommendation.member.name}\0${recommendation.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function incompatibleScopes(left: Map<string, string>, right: Map<string, string>): boolean {
  for (const [key, value] of left) {
    const other = right.get(key);
    if (other && other !== value) return true;
  }
  return false;
}

function formatterLanguage(recommendation: Recommendation): "python" | "javascript" | undefined {
  const context = recommendation.ruleText.slice(Math.max(0, recommendation.mentionStart - 50), recommendation.mentionStart + 60);
  if (/\bpython\b|\.py\b/i.test(context)) return "python";
  if (/\b(?:javascript|js|typescript|ts)\b|\.(?:tsx?|jsx?)\b/i.test(context)) return "javascript";
  if (recommendation.member.name === "black") return "python";
  if (recommendation.member.name === "prettier" || recommendation.member.name === "biome") return "javascript";
  return undefined;
}

function hasExplicitFormatterScope(text: string): boolean {
  return /\.[A-Za-z0-9]{1,5}\b|\b(?:python|javascript|typescript|\bjs\b|\bts\b|folder|directory|frontend|backend|client|server|web|api)\b|(?:^|\s)(?:src|tests?|packages|apps)\/[\w./-]+/i.test(text);
}

function formatterConflictAllowed(earlier: Recommendation, later: Recommendation): boolean {
  if (earlier.group.name !== "formatters") return true;
  if (hasExplicitFormatterScope(earlier.ruleText) || hasExplicitFormatterScope(later.ruleText)) return false;
  const earlierLanguage = formatterLanguage(earlier);
  const laterLanguage = formatterLanguage(later);
  return !earlierLanguage || !laterLanguage || earlierLanguage === laterLanguage;
}

function location(root: string, recommendation: Recommendation): string {
  const relative = path.relative(root, recommendation.file.path) || path.basename(recommendation.file.path);
  return `${relative}:${recommendation.line}`;
}

function sameScope(root: string, earlier: Recommendation, later: Recommendation): boolean {
  if (earlier.file.path !== later.file.path) {
    const earlierRoot = path.dirname(path.resolve(earlier.file.path)) === root;
    const laterRoot = path.dirname(path.resolve(later.file.path)) === root;
    if (!earlierRoot || !laterRoot) return false;
  }
  return !incompatibleScopes(earlier.scope, later.scope);
}

function conflicts(root: string, files: ParsedRulesFile[]): Issue[] {
  const recommendations = files
    .flatMap(collectRecommendations)
    .sort((a, b) => a.file.path.localeCompare(b.file.path) || a.line - b.line);
  const issues: Issue[] = [];
  const reported = new Set<string>();
  for (let laterIndex = 1; laterIndex < recommendations.length; laterIndex += 1) {
    const later = recommendations[laterIndex];
    if (!later) continue;
    const key = `${later.file.path}\0${later.group.name}`;
    if (reported.has(key)) continue;
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = recommendations[earlierIndex];
      if (!earlier || earlier.group.name !== later.group.name || earlier.member.name === later.member.name) continue;
      if (!sameScope(root, earlier, later)) continue;
      if (!formatterConflictAllowed(earlier, later)) continue;
      issues.push({
        ruleId: "tool-conflict",
        severity: "warning",
        message: `Rules recommend both "${earlier.member.name}" (${location(root, earlier)}) and "${later.member.name}" (${location(root, later)}).`,
        file: later.file.path,
        line: later.line,
      });
      reported.add(key);
      break;
    }
  }
  return issues;
}

export const toolConflictCheck: Check = {
  id: "tool-conflict",
  description: "Find conflicting recommendations for mutually exclusive tools and styles.",
  run: (ctx) => conflicts(path.resolve(ctx.root), ctx.files),
};
