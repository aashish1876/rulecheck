import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { Check, Issue, ParsedRulesFile } from "../types.js";

const globCharacters = /[*?{}]/;
const placeholder = /<[^>]+>|\{[^}]+\}|\$\{?\w+\}?|\[[^\]]+\]|path\/to\/\.\.\./i;
const generatedPath = /(?:^|\/)(?:dist|build|\.next|coverage|node_modules)(?:\/|$)/;
const createLanguage = /\b(create\w*|generat\w*|output\w*|will be created|build output)\b/i;

function expandGlobBase(value: string): string {
  const pieces = value.split("/");
  const firstGlob = pieces.findIndex((piece) => globCharacters.test(piece));
  return firstGlob < 0 ? value : pieces.slice(0, firstGlob).join("/") || ".";
}

function isSkipped(value: string, ruleText: string, root: string): boolean {
  if (placeholder.test(value) || value.startsWith("~/")) return true;
  if (path.isAbsolute(value)) {
    const resolved = path.resolve(value);
    const repo = path.resolve(root);
    if (resolved !== repo && !resolved.startsWith(`${repo}${path.sep}`)) return true;
  }
  return generatedPath.test(value.replace(/^\.\//, "")) || createLanguage.test(ruleText);
}

function findCaseMatch(target: string): string | undefined {
  const parent = path.dirname(target);
  const basename = path.basename(target);
  try {
    const names = readdirSync(parent);
    return names.find((name) => name.toLowerCase() === basename.toLowerCase());
  } catch {
    return undefined;
  }
}

function existsWithExactCase(target: string, root: string): boolean {
  const absolute = path.resolve(target);
  const repo = path.resolve(root);
  if (absolute !== repo && !absolute.startsWith(`${repo}${path.sep}`)) return existsSync(absolute);
  const pieces = path.relative(repo, absolute).split(path.sep).filter(Boolean);
  let current = repo;
  for (const piece of pieces) {
    try {
      if (!readdirSync(current).includes(piece)) return false;
    } catch {
      return false;
    }
    current = path.join(current, piece);
  }
  return existsSync(absolute);
}

function levenshtein(left: string, right: string): number {
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

function closestName(target: string): string | undefined {
  const parent = path.dirname(target);
  try {
    const names = readdirSync(parent);
    const closest = names
      .map((name) => ({ name, distance: levenshtein(path.basename(target).toLowerCase(), name.toLowerCase()) }))
      .filter(({ distance }) => distance > 0 && distance <= 2)
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))[0];
    return closest?.name;
  } catch {
    return undefined;
  }
}

function resolveReference(root: string, file: ParsedRulesFile, value: string): string[] {
  const normalized = value.replace(/\/$/, "") || ".";
  const bases = [root, path.dirname(file.path)];
  return bases.map((base) => path.resolve(base, normalized));
}

function checkReference(root: string, file: ParsedRulesFile, value: string, line: number, repoFiles: Set<string>): Issue | undefined {
  const ruleText = file.rules.find((rule) => rule.line === line)?.text ?? "";
  if (isSkipped(value, ruleText, root)) return undefined;

  if (!value.includes("/")) {
    if (repoFiles.has(value)) return undefined;
    return {
      ruleId: "stale-path",
      severity: "error",
      message: `Path "${value}" does not exist.`,
      file: file.path,
      line,
    };
  }

  const candidate = globCharacters.test(value) ? expandGlobBase(value) : value;
  if (!candidate || candidate === ".") return undefined;
  const targets = resolveReference(root, file, candidate);
  for (const target of targets) {
    if (existsWithExactCase(target, root)) {
      if (value.endsWith("/")) {
        try {
          if (!statSync(target).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      return undefined;
    }
  }

  const target = targets[0] ?? path.resolve(root, candidate);
  const caseName = findCaseMatch(target);
  const nearName = caseName ? undefined : closestName(target);
  const actual = caseName ?? nearName;
  const actualPath = actual ? path.relative(root, path.join(path.dirname(target), actual)).split(path.sep).join("/") : undefined;
  const suggestionPath = actualPath && value.endsWith("/") ? `${actualPath}/` : actualPath;
  const suggestion = suggestionPath ? `Did you mean "${suggestionPath}"?` : undefined;
  const message = `Path "${value}" does not exist.${suggestion ? ` ${suggestion}` : ""}`;
  return { ruleId: "stale-path", severity: "error", message, file: file.path, line, suggestion };
}

export const stalePathCheck: Check = {
  id: "stale-path",
  description: "Find references to files and folders that do not exist.",
  run: (ctx) => {
    const root = path.resolve(ctx.root);
    const paths = fg.sync("**/*", {
      cwd: root,
      onlyFiles: true,
      dot: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });
    const repoFiles = new Set(paths.map((item) => path.basename(item)));
    const issues: Issue[] = [];
    for (const file of ctx.files) {
      for (const reference of file.filePaths) {
        if (file.commands.some((command) => command.line === reference.line && command.value === reference.value && command.value.startsWith("./"))) continue;
        const issue = checkReference(root, file, reference.value, reference.line, repoFiles);
        if (issue) issues.push(issue);
      }
    }
    return issues;
  },
};
