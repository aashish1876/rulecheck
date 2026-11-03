import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Check, Issue, ParsedRulesFile } from "../types.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

function ancestors(start: string, root: string): string[] {
  const result: string[] = [];
  let current = path.resolve(start);
  const boundary = path.resolve(root);
  while (current === boundary || current.startsWith(`${boundary}${path.sep}`)) {
    result.push(current);
    if (current === boundary) break;
    current = path.dirname(current);
  }
  return result;
}

function readPackage(file: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function nearestPackage(root: string, file: ParsedRulesFile): { dir: string; data: PackageJson } | undefined {
  for (const dir of ancestors(path.dirname(file.path), root)) {
    const packageFile = path.join(dir, "package.json");
    if (existsSync(packageFile)) {
      const data = readPackage(packageFile);
      if (data) return { dir, data };
    }
  }
  return undefined;
}

function distance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = Math.min((row[j - 1] ?? 0) + 1, above + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[right.length] ?? 0;
}

function closestScript(name: string, scripts: string[]): string | undefined {
  return scripts
    .map((script) => ({ script, distance: distance(name, script) }))
    .filter(({ distance: score }) => score > 0)
    .sort((a, b) => a.distance - b.distance || a.script.localeCompare(b.script))[0]?.script;
}

function commandIssue(file: ParsedRulesFile, line: number, message: string, suggestion?: string, severity: Issue["severity"] = "error"): Issue {
  return {
    ruleId: "stale-command",
    severity,
    message: suggestion ? `${message}. Did you mean "${suggestion}"?` : message,
    file: file.path,
    line,
    ...(suggestion ? { suggestion } : {}),
  };
}

function verifyPackageManager(root: string, file: ParsedRulesFile, value: string, line: number, issues: Issue[]): boolean {
  const parts = value.trim().split(/\s+/);
  const manager = parts[0];
  if (!manager || !["npm", "pnpm", "yarn", "bun"].includes(manager)) return false;
  let script: string | undefined;
  if (parts[1] === "run" && parts[2]) script = parts[2];
  else if (manager !== "npm" && parts[1] && !parts[1].startsWith("-")) script = parts[1];
  else if (manager === "npm" && ["test", "start", "t"].includes(parts[1] ?? "")) script = parts[1] === "t" ? "test" : parts[1];
  if (script?.startsWith("-")) return true;
  if (!script) return true;

  const packageInfo = nearestPackage(root, file);
  if (!packageInfo) return true;
  const scripts = packageInfo.data.scripts ?? {};
  if (!scripts[script]) {
    const suggestion = closestScript(script, Object.keys(scripts));
    issues.push(commandIssue(file, line, `Script "${script}" not found in package.json`, suggestion));
  }

  if (manager === "npm" && parts[1] === "run") {
    const managerFile = [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["bun.lockb", "bun"],
      ["bun.lock", "bun"],
    ].find(([lock]) => existsSync(path.join(root, lock ?? "")));
    if (managerFile && !existsSync(path.join(root, "package-lock.json"))) {
      issues.push(commandIssue(file, line, `This repository uses ${managerFile[1]}, but the rule uses npm.`, undefined, "warning"));
    }
  }
  return true;
}

function findMakefile(root: string, file: ParsedRulesFile): string | undefined {
  for (const dir of ancestors(path.dirname(file.path), root)) {
    const makefile = path.join(dir, "Makefile");
    if (existsSync(makefile)) return makefile;
  }
  return undefined;
}

function verifyCommand(root: string, file: ParsedRulesFile, value: string, line: number, issues: Issue[]): void {
  if (verifyPackageManager(root, file, value, line, issues)) return;
  const parts = value.trim().replace(/^\$\s*/, "").split(/\s+/);
  const executable = parts[0];
  const target = parts[1];
  if (executable === "make" && target) {
    const makefile = findMakefile(root, file);
    if (!makefile) return;
    const source = readFileSync(makefile, "utf8");
    if (!new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:` , "m").test(source)) {
      issues.push(commandIssue(file, line, `Make target "${target}" not found in Makefile`));
    }
    return;
  }
  if (["node", "python", "python3", "bash", "sh"].includes(executable ?? "") && target && !target.startsWith("-")) {
    const targetPath = path.resolve(path.dirname(file.path), target);
    const rootTarget = path.resolve(root, target);
    if (!existsSync(targetPath) && !existsSync(rootTarget)) {
      issues.push(commandIssue(file, line, `Script file "${target}" does not exist`));
    }
    return;
  }
  if (executable?.startsWith("./")) {
    const targetPath = path.resolve(path.dirname(file.path), executable);
    const rootTarget = path.resolve(root, executable);
    if (!existsSync(targetPath) && !existsSync(rootTarget)) {
      issues.push(commandIssue(file, line, `Script file "${executable}" does not exist`));
    }
  }
}

export const staleCommandCheck: Check = {
  id: "stale-command",
  description: "Find known commands that reference missing scripts, targets, or files.",
  run: (ctx) => {
    const issues: Issue[] = [];
    for (const file of ctx.files) {
      for (const command of file.commands) verifyCommand(ctx.root, file, command.value, command.line, issues);
    }
    const seen = new Set<string>();
    return issues.filter((issue) => {
      const key = `${issue.file}\0${issue.line}\0${issue.ruleId}\0${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
};
