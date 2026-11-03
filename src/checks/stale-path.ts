import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { Check, Issue, ParsedRulesFile } from "../types.js";
import { isBuildArtifactPath, isPlaceholder, isUserCreatedConfigPath } from "./shared.js";

const knownBareFiles = new Set([
  "package.json", "tsconfig.json", "Makefile", "Dockerfile", "README.md", "pyproject.toml",
  "Cargo.toml", "go.mod", "docker-compose.yml",
]);
const createLanguage = /\b(create\w*|generat\w*|output\w*|will be created|build output)\b/i;

function stripRelativePrefixes(value: string): string {
  return value.replace(/^(?:\.\/|\.\.\/)+/, "");
}

function isSkipped(value: string, ruleText: string, root: string): boolean {
  if (isPlaceholder(value, ruleText) || value.startsWith("~/")) return true;
  if (path.isAbsolute(value)) {
    const resolved = path.resolve(value);
    const repo = path.resolve(root);
    if (resolved !== repo && !resolved.startsWith(`${repo}${path.sep}`)) return true;
  }
  return isBuildArtifactPath(value) || createLanguage.test(ruleText);
}

function existsWithExactCase(target: string, base: string): boolean {
  const absolute = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (absolute !== resolvedBase && !absolute.startsWith(`${resolvedBase}${path.sep}`)) return existsSync(absolute);
  const pieces = path.relative(resolvedBase, absolute).split(path.sep).filter(Boolean);
  let current = resolvedBase;
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

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function hasSuffixMatch(entries: Set<string>, candidate: string): boolean {
  const target = candidate.replace(/\/$/, "");
  for (const entry of entries) {
    if (entry === target || entry.endsWith(`/${target}`)) return true;
    if (!path.posix.extname(path.posix.basename(target))) {
      const withoutExtension = entry.replace(/\.[^/.]+$/, "");
      if (withoutExtension === target || withoutExtension.endsWith(`/${target}`)) return true;
    }
  }
  return false;
}

function closestName(target: string): string | undefined {
  const parent = path.dirname(target);
  const basename = path.basename(target);
  try {
    const names = readdirSync(parent);
    const caseMatch = names.find((name) => name !== basename && name.toLowerCase() === basename.toLowerCase());
    if (caseMatch) return caseMatch;
    const distance = (left: string, right: string): number => {
      const row = Array.from({ length: right.length + 1 }, (_, i) => i);
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
    };
    return names.map((name) => ({ name, distance: distance(basename.toLowerCase(), name.toLowerCase()) }))
      .filter((item) => item.distance > 0 && item.distance <= 2)
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))[0]?.name;
  } catch {
    return undefined;
  }
}

function resolveReference(root: string, file: ParsedRulesFile, value: string, line: number, isImport: boolean, entries: Set<string>): Issue | undefined {
  const ruleText = file.content?.split("\n")[line - 1] ?? file.rules.find((rule) => rule.line === line)?.text ?? "";
  if (isSkipped(value, ruleText, root)) return undefined;

  const candidate = value.replace(/\/$/, "") || ".";
  if (!candidate || candidate === ".") return undefined;
  const rulesDir = path.dirname(file.path);

  if (isImport) {
    const target = path.resolve(rulesDir, candidate);
    if (existsWithExactCase(target, root)) return undefined;
    return { ruleId: "stale-path", severity: "error", message: `Path "${value}" does not exist.`, file: file.path, line };
  }

  if (!candidate.includes("/")) {
    if (!knownBareFiles.has(candidate)) return undefined;
    if ([...entries].some((entry) => path.posix.basename(entry) === candidate)) return undefined;
    return { ruleId: "stale-path", severity: "error", message: `Path "${value}" does not exist.`, file: file.path, line };
  }

  const targets = [path.resolve(root, candidate), path.resolve(rulesDir, candidate)]
    .filter((target) => target === root || target.startsWith(`${root}${path.sep}`));
  for (const target of targets) {
    if (existsWithExactCase(target, root) && (!value.endsWith("/") || isDirectory(target))) return undefined;
  }
  const suffixCandidate = stripRelativePrefixes(candidate);
  if (hasSuffixMatch(entries, suffixCandidate)) return undefined;
  if (isUserCreatedConfigPath(candidate)) return undefined;

  const parentTargets = targets.map((target) => path.dirname(target));
  const matchingParent = parentTargets.find((parent) => isDirectory(parent) && existsWithExactCase(parent, root));
  if (!matchingParent) return undefined;
  const target = path.join(matchingParent, path.basename(candidate));
  const nearName = closestName(target);
  const actualPath = nearName ? path.relative(root, path.join(path.dirname(target), nearName)).split(path.sep).join("/") : undefined;
  const suggestion = actualPath && value.endsWith("/") ? `${actualPath}/` : actualPath;
  const message = `Path "${value}" does not exist.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`;
  return { ruleId: "stale-path", severity: "error", message, file: file.path, line, suggestion: suggestion ? `Did you mean "${suggestion}"?` : undefined };
}

export const stalePathCheck: Check = {
  id: "stale-path",
  description: "Find references to files and folders that do not exist.",
  run: (ctx) => {
    const root = path.resolve(ctx.root);
    const found = fg.sync("**/*", {
      cwd: root,
      onlyFiles: false,
      dot: true,
      suppressErrors: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });
    const entries = new Set(found.map((item) => item.split(path.sep).join("/")));
    const issues: Issue[] = [];
    for (const file of ctx.files) {
      for (const reference of file.filePaths) {
        const matchingCommand = file.commands.some((command) => command.line === reference.line && command.value === reference.value && command.value.startsWith("./"));
        if (matchingCommand) continue;
        const issue = resolveReference(root, file, reference.value, reference.line, reference.isImport ?? false, entries);
        if (issue) issues.push(issue);
      }
    }
    return issues;
  },
};
