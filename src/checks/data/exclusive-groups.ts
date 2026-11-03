export interface ExclusiveChoice {
  value: string;
  pattern: RegExp;
}

export interface ExclusiveGroup {
  id: string;
  choices: ExclusiveChoice[];
}

export interface ToolConflictMember {
  name: string;
  aliases: string[];
}

export interface ToolConflictGroup {
  name: string;
  members: ToolConflictMember[];
}

export const toolConflictGroups: ToolConflictGroup[] = [
  { name: "package managers", members: ["npm", "pnpm", "yarn", "bun"].map((name) => ({ name, aliases: [name] })) },
  { name: "Python test runners", members: ["pytest", "unittest", "nose"].map((name) => ({ name, aliases: [name] })) },
  { name: "JavaScript test runners", members: ["jest", "vitest", "mocha"].map((name) => ({ name, aliases: [name] })) },
  { name: "formatters", members: ["prettier", "biome", "black"].map((name) => ({ name, aliases: [name] })) },
  {
    name: "indentation",
    members: [
      { name: "tabs", aliases: ["tab", "tabs"] },
      { name: "spaces", aliases: ["space", "spaces"] },
    ],
  },
  {
    name: "quotes",
    members: [
      { name: "single quotes", aliases: ["single quote", "single quotes"] },
      { name: "double quotes", aliases: ["double quote", "double quotes"] },
    ],
  },
];

const choice = (value: string, pattern: RegExp): ExclusiveChoice => ({ value, pattern });

export const exclusiveGroups: ExclusiveGroup[] = [
  {
    id: "package managers",
    choices: ["npm", "pnpm", "yarn", "bun"].map((name) => choice(name, new RegExp(`\\b${name}\\b`, "i"))),
  },
  {
    id: "Python test runners",
    choices: ["pytest", "unittest", "nose"].map((name) => choice(name, new RegExp(`\\b${name}\\b`, "i"))),
  },
  {
    id: "JavaScript test runners",
    choices: ["jest", "vitest", "mocha"].map((name) => choice(name, new RegExp(`\\b${name}\\b`, "i"))),
  },
  {
    id: "formatters",
    choices: [
      choice("prettier", /\bprettier\b/i), choice("biome", /\bbiome\b/i), choice("black", /\bblack\b/i),
      choice("ruff format", /\bruff\s+format\b/i),
    ],
  },
  {
    id: "indentation",
    choices: [choice("tabs", /\btabs?\b/i), choice("spaces", /\bspaces?\b/i)],
  },
  {
    id: "quotes",
    choices: [choice("single quotes", /\bsingle[- ]quotes?\b/i), choice("double quotes", /\bdouble[- ]quotes?\b/i)],
  },
];
