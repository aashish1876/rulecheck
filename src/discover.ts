import fg from "fast-glob";
import path from "node:path";
import type { DiscoveredRulesFile, RulesFileType } from "./types.js";

const patterns: Array<{ pattern: string; type: RulesFileType }> = [
  { pattern: "AGENTS.md", type: "agents" },
  { pattern: "**/AGENTS.md", type: "agents" },
  { pattern: "CLAUDE.md", type: "claude" },
  { pattern: "**/CLAUDE.md", type: "claude" },
  { pattern: ".cursorrules", type: "cursorrules" },
  { pattern: ".github/copilot-instructions.md", type: "copilot" },
  { pattern: ".cursor/rules/*.mdc", type: "cursor-mdc" },
];

const defaultIgnores = ["**/node_modules/**", "**/.git/**", "**/dist/**"];

export async function discoverRulesFiles(root: string, ignore: string[] = []): Promise<DiscoveredRulesFile[]> {
  const found = await Promise.all(
    patterns.map(async ({ pattern, type }) => {
      const paths = await fg(pattern, {
        cwd: root,
        onlyFiles: true,
        dot: true,
        suppressErrors: true,
        ignore: [...defaultIgnores, ...ignore],
      });
      return paths.map((file) => ({ path: path.resolve(root, file), type }));
    }),
  );

  const unique = new Map<string, DiscoveredRulesFile>();
  for (const file of found.flat()) unique.set(file.path, file);
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
}
