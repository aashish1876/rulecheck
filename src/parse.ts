import { fromMarkdown } from "mdast-util-from-markdown";
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

const pathPattern = /(?:(?:\.\.\/|\.\/|~\/)+|@)?[\w@.*?{}<>$-]+(?:\/[\w@.*?{}<>$-]+)*\/?/g;
const commandPrefix = "(?:cd\\s+.+?\\s*&&\\s*)?";
const commandPattern = new RegExp(`^${commandPrefix}(?:npm|npx|pnpm|yarn|bun|node|python(?:3)?|pytest|make|cargo|go|git|uv)(?:\\s|$)|^${commandPrefix}\\./[^\\s]+`);
const shellCommandPattern = new RegExp(`^${commandPrefix}(?:(?:npm|npx|pnpm|yarn|bun|node|python(?:3)?|pytest|make|cargo|go|git|uv)\\b.*|\\./\\S+.*)$`);
const urlPattern = /^https?:\/\//i;
const allowedPathExtensions = new Set("ts tsx js jsx mjs cjs json md mdx yml yaml toml py rs go java kt swift rb php c cc cpp h hpp cs sh bash sql html css scss vue svelte txt lock ini cfg xml gradle tf proto ipynb env".split(" "));
const pathExtension = /\.([A-Za-z0-9]+)$/;
const numericRatio = /^\d+(?:[.-]\d+)*(?:\/\d+(?:[.-]\d+)*)+$/;
const versionPair = /^v?\d+(?:\.\d+)+\/v?\d+(?:\.\d+)+$/i;
const commonAbbreviation = /^(?:e\.g|i\.e|etc|vs)$/i;

export function parseRules(markdown: string, _options: { root?: string; filePath?: string } = {}): ParsedRules {
  const tree = fromMarkdown(markdown) as Root;
  const headings: ParsedRules["headings"] = [];
  const rules: Rule[] = [];
  const filePaths: Reference[] = [];
  const commands: Reference[] = [];
  let currentHeading: string | null = null;
  const addPath = (value: string, line: number, inCode: boolean): void => {
    if (!value || /\s/.test(value) || value.startsWith("//") || value.includes(":") || urlPattern.test(value)) return;
    if (numericRatio.test(value) || versionPair.test(value) || commonAbbreviation.test(value)) return;
    const slashes = [...value].filter((character) => character === "/").length;
    const scopedPath = value.startsWith("@") && slashes >= 2 && !value.startsWith("@./") && !value.startsWith("@../");
    const isImport = value.startsWith("@") && !scopedPath;
    if (isImport) value = value.slice(1);
    const lastSegment = value.replace(/\/$/, "").split("/").at(-1) ?? "";
    const extension = pathExtension.exec(lastSegment)?.[1]?.toLowerCase();
    if (!value.endsWith("/") && (!extension || !allowedPathExtensions.has(extension))) return;
    if (!filePaths.some((ref) => ref.value === value && ref.line === line)) filePaths.push({ value, line, ...(isImport ? { isImport: true } : {}) });
  };

  const scanText = (value: string, line: number, inCode = false): void => {
    const withoutUrls = value.replace(/https?:\/\/\S+/gi, " ");
    for (const match of withoutUrls.matchAll(pathPattern)) {
      const candidate = match[0].replace(/[.,;:!?]+$/, "");
      const matchLine = line + withoutUrls.slice(0, match.index ?? 0).split("\n").length - 1;
      if (candidate) addPath(candidate, matchLine, inCode);
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
