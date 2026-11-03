export type RulesFileType =
  | "agents"
  | "claude"
  | "cursorrules"
  | "copilot"
  | "cursor-mdc";

export interface DiscoveredRulesFile {
  path: string;
  type: RulesFileType;
}

export interface Heading {
  text: string;
  depth: number;
  line: number;
}

export interface Rule {
  text: string;
  line: number;
  parentHeading: string | null;
}

export interface Reference {
  value: string;
  line: number;
}

export interface ParsedRules {
  headings: Heading[];
  rules: Rule[];
  filePaths: Reference[];
  commands: Reference[];
}

export interface ParsedRulesFile extends ParsedRules {
  path: string;
  type: RulesFileType;
  content?: string;
}

export interface Issue {
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
  file: string;
  line: number;
  suggestion?: string;
}

export interface CheckContext {
  root: string;
  files: ParsedRulesFile[];
}

export interface Check {
  id: string;
  description: string;
  run(ctx: CheckContext): Issue[];
}
