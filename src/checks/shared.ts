const placeholderToken = /(?:^|[^a-z0-9])(?:yyyy|mm|dd|path\/to|my_|example|your|foo|bar)(?:$|[^a-z0-9])/i;
const buildArtifactSegments = new Set([
  "target", "tmp", "temp", "dist", "build", "out", ".build", ".cache", "cache",
  "coverage", ".next", ".nuxt", "node_modules", "venv", ".venv", "__pycache__", ".turbo",
]);

export function isPlaceholder(value: string): boolean {
  return /[*?{}<>$]/.test(value)
    || placeholderToken.test(value)
    || value.split("/").some((segment) => /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(segment));
}

export function isBuildArtifactPath(value: string): boolean {
  return value.replace(/^(?:\.\/|\.\.\/)+/, "").split("/").some((segment) => buildArtifactSegments.has(segment.toLowerCase()));
}
