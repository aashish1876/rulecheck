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
