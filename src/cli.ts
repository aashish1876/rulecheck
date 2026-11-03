#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import pc from "picocolors";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { discoverRulesFiles } from "./discover.js";
import { parseRules } from "./parse.js";
import { runChecks } from "./checks/index.js";
import { score } from "./score.js";
import type { Issue, ParsedRulesFile } from "./types.js";

type OutputFormat = "text" | "json";

interface CliOptions {
  ignore: string[];
  verbose?: boolean;
  format: OutputFormat;
  maxWarnings?: number;
  minScore?: number;
  color?: boolean;
}

function collectIgnore(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseInteger(value: string, name: string, maximum?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (maximum !== undefined && parsed > maximum)) {
    throw new InvalidArgumentError(`${name} must be an integer from 0${maximum === undefined ? "" : ` to ${maximum}`}.`);
  }
  return parsed;
}

function colorize(enabled: boolean, color: (value: string) => string, value: string): string {
  return enabled ? color(value) : value;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function relativeFile(root: string, file: string): string {
  return path.relative(root, path.resolve(root, file)) || path.basename(file);
}

function issueCounts(issues: Issue[]) {
  return {
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    infos: issues.filter((issue) => issue.severity === "info").length,
  };
}

function printText(
  root: string,
  files: ParsedRulesFile[],
  issues: Issue[],
  result: ReturnType<typeof score>,
  options: CliOptions,
  enabledColor: boolean,
): void {
  if (files.length === 0) {
    console.log(colorize(enabledColor, pc.dim, "No rules files found."));
    return;
  }
  const ruleCount = files.reduce((sum, file) => sum + file.rules.length, 0);
  const pathCount = files.reduce((sum, file) => sum + file.filePaths.length, 0);
  const commandCount = files.reduce((sum, file) => sum + file.commands.length, 0);
  console.log(colorize(enabledColor, pc.dim, `\nFound ${files.length} rules files. ${ruleCount} rules, ${pathCount} path references, ${commandCount} commands.`));

  const visibleIssues = issues.filter((issue) => options.verbose || issue.severity !== "info");
  const grouped = new Map<string, Issue[]>();
  for (const issue of visibleIssues) {
    const label = relativeFile(root, issue.file);
    const group = grouped.get(label) ?? [];
    group.push(issue);
    grouped.set(label, group);
  }
  for (const [label, fileIssues] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n${label}`);
    for (const issue of fileIssues.sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId))) {
      const color = issue.severity === "error" ? pc.red : issue.severity === "warning" ? pc.yellow : pc.dim;
      const line = String(issue.line).padStart(4);
      console.log(`  ${line}  ${colorize(enabledColor, color, issue.severity.padEnd(7))} ${issue.message}  ${colorize(enabledColor, pc.dim, issue.ruleId)}`);
    }
  }

  const counts = issueCounts(issues);
  const problemCount = counts.errors + counts.warnings;
  if (problemCount === 0) {
    console.log(colorize(enabledColor, pc.green, "No problems found."));
  } else {
    console.log(`\n${plural(problemCount, "problem")} (${plural(counts.errors, "error")}, ${plural(counts.warnings, "warning")})`);
  }
  if (result) {
    const scoreColor = result.score >= 90 ? pc.green : result.score >= 50 ? pc.yellow : pc.red;
    console.log(colorize(enabledColor, scoreColor, `Score: ${result.score}/100 (${result.grade})`));
    if (options.verbose) {
      console.log("Penalty breakdown:");
      for (const entry of result.breakdown) {
        console.log(`  ${entry.ruleId}: ${entry.errors} errors, ${entry.warnings} warnings, ${entry.penalty} penalty`);
      }
    }
  }
}

function printJson(root: string, version: string, files: ParsedRulesFile[], issues: Issue[], result: ReturnType<typeof score>): void {
  const counts = issueCounts(issues);
  const output = {
    version,
    score: result?.score ?? null,
    grade: result?.grade ?? null,
    summary: {
      files: files.length,
      rules: files.reduce((sum, file) => sum + file.rules.length, 0),
      ...counts,
    },
    files: files.map((file) => ({ path: relativeFile(root, file.path), type: file.type })),
    issues: issues.map((issue) => ({
      ruleId: issue.ruleId,
      severity: issue.severity,
      message: issue.message,
      file: relativeFile(root, issue.file),
      line: issue.line,
      ...(issue.suggestion === undefined ? {} : { suggestion: issue.suggestion }),
    })),
    breakdown: result?.breakdown ?? [],
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function run(dir: string, options: CliOptions): Promise<void> {
  const root = path.resolve(dir);
  const directory = await stat(root).catch(() => undefined);
  if (!directory?.isDirectory()) throw new Error(`Not a readable directory: ${dir}`);
  await access(root, 4).catch(() => { throw new Error(`Not a readable directory: ${dir}`); });

  const discovered = await discoverRulesFiles(root, options.ignore);
  const parsedFiles: ParsedRulesFile[] = [];
  for (const file of discovered) {
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read rules file "${file.path}": ${detail}`);
    }
    const parsed = parseRules(content, { root, filePath: file.path });
    parsedFiles.push({ ...file, ...parsed, content });
  }

  const issues = runChecks({ root, files: parsedFiles });
  const result = score(issues, { files: parsedFiles.length });
  if (options.format === "json") {
    if (parsedFiles.length === 0) process.stderr.write("No rules files found.\n");
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    printJson(root, packageJson.version, parsedFiles, issues, result);
  } else {
    printText(root, parsedFiles, issues, result, options, options.color !== false && !process.env.NO_COLOR);
  }

  const counts = issueCounts(issues);
  const maxWarningsFailed = options.maxWarnings !== undefined && counts.warnings > options.maxWarnings;
  const minScoreFailed = options.minScore !== undefined && (result === null || result.score < options.minScore);
  if (counts.errors > 0 || maxWarningsFailed || minScoreFailed) process.exitCode = 1;
}

const program = new Command();
program
  .name("rulecheck")
  .description("Inspect AI agent rules files")
  .version("0.0.1")
  .argument("[dir]", "directory to inspect", ".")
  .option("--ignore <glob>", "exclude matching paths (repeatable)", collectIgnore, [])
  .option("--verbose", "show informational findings and score breakdown")
  .addOption(new Option("--format <format>", "output format").choices(["text", "json"]).default("text"))
  .option("--max-warnings <n>", "maximum warnings allowed", (value: string) => parseInteger(value, "--max-warnings"))
  .option("--min-score <n>", "minimum score required (0-100)", (value: string) => parseInteger(value, "--min-score", 100))
  .option("--no-color", "disable colored output")
  .configureOutput({ writeErr: (message) => process.stderr.write(message) })
  .exitOverride()
  .action(async (dir: string, options: CliOptions) => run(dir, options));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode !== 0) process.exitCode = 2;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`rulecheck: ${message}\n`);
    process.exitCode = 2;
  }
}
