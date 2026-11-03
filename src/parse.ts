import { fromMarkdown } from "mdast-util-from-markdown";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Root, RootContent, List, ListItem, PhrasingContent, Text } from "mdast";
import type { ParsedRules, Reference, Rule } from "./types.js";

function lineOf(node: { position?: { start: { line: number } } }): number {
  return node.position?.start.line ?? 1;
}

function textOf(node: PhrasingContent | RootContent): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if ("children" in node) return node.children.map((child) => textOf(child as PhrasingContent)).join("");
  return "";
}

function listItemText(item: ListItem): string {
  return item.children.map((child) => textOf(child as RootContent)).filter(Boolean).join(" ").trim();
}

const pathPattern = /(?:\.\.\/|\.\/|~\/)?[\w@.-]+(?:\/[\w@.-]+)*\/?/g;
const commandPattern = /^(?:npm|npx|pnpm|yarn|bun|node|python(?:3)?|pytest|make|cargo|go|git|uv)(?:\s|$)|^\.\/[^\s]+/;
const shellCommandPattern = /^(?:(?:npm|npx|pnpm|yarn|bun|node|python(?:3)?|pytest|make|cargo|go|git|uv)\b.*|\.\/\S+.*)$/;
const urlPattern = /^https?:\/\//i;
const pathExtension = /(?:^|\/)[^/.][^/]*\.[A-Za-z0-9]{1,5}$/;
const slashNonPaths = /^(?:and\/or|w\/o|i\/o|tcp\/ip|ci\/cd)$/i;
const numericRatio = /^\d+(?:[.-]\d+)*(?:\/\d+(?:[.-]\d+)*)+$/;
const versionPair = /^v?\d+(?:\.\d+)+\/v?\d+(?:\.\d+)+$/i;
const commonAbbreviation = /^(?:e\.g|i\.e|etc|vs)$/i;

interface ParseOptions {
  root?: string;
  filePath?: string;
}

export function parseRules(markdown: string, options: ParseOptions = {}): ParsedRules {
  const tree = fromMarkdown(markdown) as Root;
  const headings: ParsedRules["headings"] = [];
  const rules: Rule[] = [];
  const filePaths: Reference[] = [];
  const commands: Reference[] = [];
  let currentHeading: string | null = null;
  const addPath = (value: string, line: number, inCode: boolean): void => {
    if (!value || /\s/.test(value) || value.startsWith("//") || value.includes(":") || urlPattern.test(value)) return;
    if (slashNonPaths.test(value) || numericRatio.test(value) || versionPair.test(value) || commonAbbreviation.test(value)) return;
    const hasSlash = value.includes("/");
    const hasExtension = pathExtension.test(value);
    const hasTrailingSlash = value.endsWith("/");
    const explicitRelative = /^(?:\.\/|\.\.\/|~\/)/.test(value);
    if (!hasExtension && !hasTrailingSlash && !explicitRelative) {
      if (!inCode || !hasSlash || !options.root) return;
      const first = value.split("/")[0];
      if (!first) return;
      const roots = [options.root, options.filePath ? path.dirname(options.filePath) : undefined].filter((item): item is string => Boolean(item));
      if (!roots.some((root) => existsSync(path.resolve(root, first)))) return;
    }
    if (!filePaths.some((ref) => ref.value === value && ref.line === line)) filePaths.push({ value, line });
  };

  const scanText = (value: string, line: number, inCode = false): void => {
    const withoutUrls = value.replace(/https?:\/\/\S+/gi, " ");
    for (const match of withoutUrls.matchAll(pathPattern)) {
      const candidate = match[0].replace(/[.,;:!?]+$/, "");
      if (/^[A-Z][a-z]+\.[A-Za-z]+$/.test(candidate)) continue;
      if (candidate) addPath(candidate, line, inCode);
    }
  };

  const walk = (nodes: RootContent[], heading: string | null): string | null => {
    let activeHeading = heading;
    for (const node of nodes) {
      if (node.type === "heading") {
        activeHeading = node.children.map((child) => textOf(child)).join("").trim();
        headings.push({ text: activeHeading, depth: node.depth, line: lineOf(node) });
      } else if (node.type === "list") {
        collectList(node, activeHeading);
      } else if (node.type === "code") {
        if (!node.lang || /^(sh|bash|shell|zsh|console)$/i.test(node.lang)) {
          for (const [index, raw] of node.value.split("\n").entries()) {
            const value = raw.trim().replace(/^\$\s*/, "");
            if (shellCommandPattern.test(value)) commands.push({ value, line: lineOf(node) + index });
          }
        }
        for (const [index, codeLine] of node.value.split("\n").entries()) scanText(codeLine, lineOf(node) + index, true);
      } else if (node.type === "paragraph") {
        for (const child of node.children) {
          const line = lineOf(child);
          if (child.type === "inlineCode") {
            if (commandPattern.test(child.value)) {
              commands.push({ value: child.value, line });
              if (child.value.startsWith("./")) addPath(child.value, line, true);
            }
            else addPath(child.value, line, true);
          } else if (child.type === "text") scanText(child.value, line);
        }
      } else if ("children" in node) {
        activeHeading = walk(node.children as RootContent[], activeHeading);
      }
    }
    return activeHeading;
  };

  function collectList(list: List, heading: string | null): void {
    const visit = (item: ListItem): void => {
      const content = item.children.filter((child) => child.type !== "list");
      const value = content.map((child) => textOf(child as RootContent)).filter(Boolean).join(" ").trim();
      if (value) rules.push({ text: value, line: lineOf(item), parentHeading: heading });
      for (const child of item.children) {
        if (child.type === "list") for (const nested of child.children) visit(nested);
        else if (child.type === "paragraph") {
          for (const part of child.children) {
            if (part.type === "inlineCode") {
              if (commandPattern.test(part.value)) {
                commands.push({ value: part.value, line: lineOf(part) });
                if (part.value.startsWith("./")) addPath(part.value, lineOf(part), true);
              }
              else addPath(part.value, lineOf(part), true);
            } else if (part.type === "text") scanText(part.value, lineOf(part));
          }
        }
      }
    };
    for (const item of list.children) visit(item);
  }

  walk(tree.children, null);
  return { headings, rules, filePaths, commands };
}
