import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { Check, Issue, ParsedRulesFile } from "../types.js";
import { isBuildArtifactPath, isPlaceholder } from "./shared.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

interface RepoCommands {
  scripts: Set<string>;
  nearestScripts: Map<string, Set<string>>;
  makeTargets: Set<string>;
  canCheckMake: boolean;
}

const packageManagers = new Set(["npm", "pnpm", "yarn", "bun"]);
const skipFlags = new Set(["--filter", "-F", "--workspace", "-w", "--prefix", "-C", "--cwd", "--dir", "-r", "--recursive"]);
const scriptExtensions = new Set(["js", "mjs", "cjs", "ts", "py", "sh", "bash", "rb", "pl"]);

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

function collectRepoCommands(root: string): RepoCommands {
  const packageFiles = fg.sync("**/package.json", {
    cwd: root, onlyFiles: true, dot: true, suppressErrors: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
  });
  const scripts = new Set<string>();
  const nearestScripts = new Map<string, Set<string>>();
  for (const relative of packageFiles) {
    const absolute = path.resolve(root, relative);
    const values = Object.keys(readPackage(absolute)?.scripts ?? {});
    values.forEach((script) => scripts.add(script));
    nearestScripts.set(path.dirname(absolute), new Set(values));
  }

  const makeFiles = fg.sync(["**/Makefile", "**/GNUmakefile", "**/*.mk"], {
    cwd: root, onlyFiles: true, dot: true, suppressErrors: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
  });
  const makeTargets = new Set<string>();
  let canCheckMake = true;
  for (const relative of makeFiles) {
    let source: string;
    try {
      source = readFileSync(path.resolve(root, relative), "utf8");
    } catch {
      continue;
    }
    if (/^\s*-?include\b/m.test(source)) canCheckMake = false;
    for (const line of source.split("\n")) {
      const targetPart = line.replace(/\s+#.*$/, "").match(/^\s*([^:=\s][^:]*)\s*:/)?.[1];
      if (!targetPart) continue;
      for (const target of targetPart.trim().split(/\s+/)) {
        if (!target.includes("$(") && !target.includes("%")) makeTargets.add(target);
      }
    }
  }
  return { scripts, nearestScripts, makeTargets, canCheckMake };
}

function closestScript(name: string, scripts: string[]): string | undefined {
  return scripts
    .map((script) => ({ script, distance: editDistance(name, script) }))
    .filter(({ distance }) => distance > 0)
    .sort((a, b) => a.distance - b.distance || a.script.localeCompare(b.script))[0]?.script;
}

function editDistance(left: string, right: string): number {
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

function commandIssue(file: ParsedRulesFile, line: number, message: string, suggestion?: string, severity: Issue["severity"] = "error"): Issue {
  return {
    ruleId: "stale-command", severity,
    message: suggestion ? `${message}. Did you mean "${suggestion}"?` : message,
    file: file.path, line, ...(suggestion ? { suggestion } : {}),
  };
}

function skippedCommand(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.some((part) => skipFlags.has(part)) || /^cd\s+.+?\s*&&\s*/.test(value.trim());
}

function verifyPackageManager(root: string, file: ParsedRulesFile, value: string, line: number, data: RepoCommands, issues: Issue[]): boolean {
  const parts = value.trim().split(/\s+/);
  const manager = parts[0];
  if (!manager || !packageManagers.has(manager)) return false;

  const isRun = parts[1] === "run" && Boolean(parts[2]);
  const isNpmRunScript = manager === "npm" && parts[1] === "run-script" && Boolean(parts[2]);
  if (!isRun && !isNpmRunScript) return true;
  const script = parts[2];
  if (!script || script.startsWith("-")) return true;
  const nearbyPackage = ancestors(path.dirname(file.path), root)
    .map((directory) => data.nearestScripts.get(directory))
    .find((names) => names !== undefined);
  if (!data.scripts.has(script)) {
    const suggestions = [...(nearbyPackage ?? []), ...data.scripts];
    issues.push(commandIssue(file, line, `Script "${script}" not found in package.json`, closestScript(script, [...new Set(suggestions)])));
  }

  if (manager === "npm" && isRun) {
    const managerFile = [
      ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"],
    ].find(([lock]) => existsSync(path.join(root, lock ?? "")));
    if (managerFile && !existsSync(path.join(root, "package-lock.json"))) {
      issues.push(commandIssue(file, line, `This repository uses ${managerFile[1]}, but the rule uses npm.`, undefined, "warning"));
    }
  }
  return true;
}

function hasExactEntry(target: string, base: string): boolean {
  const absolute = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (absolute !== resolvedBase && !absolute.startsWith(`${resolvedBase}${path.sep}`)) return false;
  let current = resolvedBase;
  for (const segment of path.relative(resolvedBase, absolute).split(path.sep).filter(Boolean)) {
    try {
      if (!readdirSync(current).includes(segment)) return false;
    } catch {
      return false;
    }
    current = path.join(current, segment);
  }
  return existsSync(absolute);
}

function verifyDirectScript(root: string, file: ParsedRulesFile, target: string, line: number, issues: Issue[]): void {
  if (!target || target.endsWith("/") || isBuildArtifactPath(target) || isPlaceholder(target)) return;
  const basename = path.posix.basename(target);
  const extension = path.posix.extname(basename).slice(1).toLowerCase();
  if (!scriptExtensions.has(extension)) return;
  const bases = [root, path.dirname(file.path)];
  if (bases.some((base) => hasExactEntry(path.resolve(base, target), base))) return;

  const parent = path.posix.dirname(target);
  if (parent === ".") return;
  const parentExists = bases.some((base) => hasExactEntry(path.resolve(base, parent), base));
  if (parentExists) issues.push(commandIssue(file, line, `Script file "${target}" does not exist`));
}

function verifyCommand(root: string, file: ParsedRulesFile, value: string, line: number, data: RepoCommands, issues: Issue[]): void {
  if (skippedCommand(value)) return;
  if (verifyPackageManager(root, file, value, line, data, issues)) return;

  const parts = value.trim().replace(/^\$\s*/, "").split(/\s+/);
  const executable = parts[0];
  if (executable === "make" && parts[1]) {
    if (data.canCheckMake && !data.makeTargets.has(parts[1])) {
      issues.push(commandIssue(file, line, `Make target "${parts[1]}" not found in Makefile`));
    }
    return;
  }
  if (["node", "python", "python3", "bash", "sh"].includes(executable ?? "")) {
    verifyDirectScript(root, file, parts[1] ?? "", line, issues);
    return;
  }
  if (executable?.startsWith("./")) verifyDirectScript(root, file, executable, line, issues);
}

export const staleCommandCheck: Check = {
  id: "stale-command",
  description: "Find known commands that reference missing scripts, targets, or files.",
  run: (ctx) => {
    const data = collectRepoCommands(path.resolve(ctx.root));
    const issues: Issue[] = [];
    for (const file of ctx.files) {
      for (const command of file.commands) verifyCommand(ctx.root, file, command.value, command.line, data, issues);
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
