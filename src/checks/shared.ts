import { readFileSync } from "node:fs";
import path from "node:path";

const buildArtifactSegments = new Set([
  "target", "tmp", "temp", "dist", "build", "out", ".build", ".cache", "cache",
  "coverage", ".next", ".nuxt", "node_modules", "venv", ".venv", "__pycache__", ".turbo",
]);
const placeholderWords = ["my", "your", "some", "example", "sample", "foo", "bar", "baz", "tmp", "temp", "yyyy", "mm", "dd"];
const exampleContext = /\be\.g\.|\b(?:for example|such as|example|creat\w*|generat\w*|copy|your own|locally|gitignored|optional|template|may|might|if exists|if present|if any|installed package|node_modules|inside that)\b|\(if\b/i;

export function isPlaceholder(value: string, ruleText = ""): boolean {
  if (/[?*{}<>$]/.test(value) || /path\/to/i.test(value) || exampleContext.test(ruleText)) return true;
  return value.split("/").some((segment) => {
    const lower = segment.toLowerCase();
    const withoutExtension = lower.replace(/\.[^.]+$/, "");
    const words = withoutExtension.split(/[-_.]+/).filter(Boolean);
    return placeholderWords.some((word) => withoutExtension.startsWith(word) || words.includes(word))
      || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(segment);
  });
}

export function isBuildArtifactPath(value: string): boolean {
  return value.replace(/^(?:\.\/|\.\.\/)+/, "").split("/").some((segment) => {
    const normalized = segment.toLowerCase();
    return buildArtifactSegments.has(normalized) || ["cache", "generated", "output", "artifacts"].some((part) => normalized.includes(part));
  });
}

export function isUserCreatedConfigPath(value: string): boolean {
  const name = value.split("/").at(-1)?.toLowerCase() ?? "";
  return name.startsWith(".env") || /^(?:custom|local)\./.test(name) || /\.local\.[^.]+$/.test(name);
}

function globExpression(pattern: string): RegExp {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*" && pattern[index + 2] === "/") {
      expression += "(?:.*/)?";
      index += 2;
    } else if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&") ?? "";
  }
  return new RegExp(`^${expression}$`);
}

function patternMatches(pattern: string, relativePath: string): boolean {
  const directoryOnly = pattern.endsWith("/");
  const anchored = pattern.startsWith("/");
  const normalized = pattern.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  if (!normalized) return false;
  if (normalized.includes("/")) {
    const expression = globExpression(normalized);
    return expression.test(relativePath) || (directoryOnly && relativePath.startsWith(`${normalized}/`));
  }
  const expression = globExpression(normalized);
  if (anchored) return expression.test(relativePath) || (directoryOnly && relativePath.startsWith(`${normalized}/`));
  return relativePath.split("/").some((segment) => expression.test(segment));
}

export function isGitignoredPath(root: string, rulesDir: string, targets: string[]): boolean {
  const ignoreDirs = [...new Set([path.resolve(root), path.resolve(rulesDir)])];
  for (const target of targets) {
    let ignored = false;
    for (const ignoreDir of ignoreDirs) {
      const absoluteTarget = path.resolve(target);
      const relativeTarget = path.relative(ignoreDir, absoluteTarget).split(path.sep).join("/");
      if (relativeTarget === ".." || relativeTarget.startsWith("../") || path.isAbsolute(relativeTarget)) continue;
      try {
        const lines = readFileSync(path.join(ignoreDir, ".gitignore"), "utf8").split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const negated = line.startsWith("!");
          const pattern = negated ? line.slice(1) : line;
          const candidates = relativeTarget.split("/").reduce<string[]>((paths, segment) => {
            const parent = paths.at(-1) ?? "";
            paths.push(parent ? `${parent}/${segment}` : segment);
            return paths;
          }, []);
          if (candidates.some((candidate) => patternMatches(pattern, candidate))) ignored = !negated;
        }
      } catch {
        continue;
      }
    }
    if (ignored) return true;
  }
  return false;
}
