import path from "node:path";
import type { Check, CheckContext, Issue } from "../types.js";
import { staleCommandCheck } from "./stale-command.js";
import { stalePathCheck } from "./stale-path.js";
import { duplicateRuleCheck } from "./duplicate-rule.js";
import { tokenCostCheck } from "./token-cost.js";
import { toolConflictCheck } from "./tool-conflict.js";

export const checks: Check[] = [stalePathCheck, staleCommandCheck, duplicateRuleCheck, tokenCostCheck, toolConflictCheck];

export function runChecks(ctx: CheckContext): Issue[] {
  const issues = checks
    .flatMap((check) => check.run(ctx))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([path.resolve(issue.file), issue.line, issue.ruleId, issue.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
