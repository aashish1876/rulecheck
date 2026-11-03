import path from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import type { Check, CheckContext, Issue } from "../types.js";
import { staleCommandCheck } from "./stale-command.js";
import { stalePathCheck } from "./stale-path.js";
import { duplicateRuleCheck } from "./duplicate-rule.js";
import { tokenCostCheck } from "./token-cost.js";
import { toolConflictCheck } from "./tool-conflict.js";
import { opposedDirectiveCheck } from "./opposed-directive.js";

export const checks: Check[] = [stalePathCheck, staleCommandCheck, duplicateRuleCheck, tokenCostCheck, toolConflictCheck, opposedDirectiveCheck];

export function runChecks(ctx: CheckContext): Issue[] {
  const seenRealPaths = new Set<string>();
  const seenContents = new Map<string, string>();
  const uniqueFiles: CheckContext["files"] = [];
  const identicalIssues: Issue[] = [];
  for (const file of [...ctx.files].sort((a, b) => a.path.localeCompare(b.path))) {
    let realPath = path.resolve(file.path);
    try { realPath = realpathSync(file.path); } catch { /* keep the normalized path */ }
    if (seenRealPaths.has(realPath)) continue;
    seenRealPaths.add(realPath);

    let content: string | undefined;
    try { content = readFileSync(file.path).toString("base64"); }
    catch { if (file.content !== undefined) content = Buffer.from(file.content).toString("base64"); }
    if (content !== undefined && seenContents.has(content)) {
      const first = seenContents.get(content) as string;
      identicalIssues.push({
        ruleId: "duplicate-rule", severity: "info", message: `Identical to ${path.relative(ctx.root, first) || path.basename(first)}`,
        file: file.path, line: 1,
      });
      continue;
    }
    if (content !== undefined) seenContents.set(content, file.path);
    uniqueFiles.push(file);
  }
  const issues = checks
    .flatMap((check) => check.run({ ...ctx, files: uniqueFiles }))
    .concat(identicalIssues)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([path.resolve(issue.file), issue.line, issue.ruleId, issue.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
