#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { readFile } from "node:fs/promises";
import { discoverRulesFiles } from "./discover.js";
import { parseRules } from "./parse.js";
import { runChecks } from "./checks/index.js";
import type { ParsedRulesFile } from "./types.js";
import path from "node:path";

function collectIgnore(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const severityWidth = "warning".length;

const program = new Command();
program
  .name("rulecheck")
  .description("Inspect AI agent rules files")
  .version("0.0.1")
  .argument("[dir]", "directory to inspect", ".")
  .option("--ignore <glob>", "exclude matching paths (repeatable)", collectIgnore, [])
  .option("--verbose", "show informational findings")
  .action(async (dir: string, options: { ignore: string[]; verbose?: boolean }) => {
    const files = await discoverRulesFiles(dir, options.ignore);
    if (files.length === 0) {
      console.log(pc.dim("No rules files found."));
      return;
    }
    const parsedFiles: ParsedRulesFile[] = [];
    for (const file of files) {
      const content = await readFile(file.path, "utf8");
      const parsed = parseRules(content, { root: path.resolve(dir), filePath: file.path });
      parsedFiles.push({ ...file, ...parsed, content });
    }
    const ruleCount = parsedFiles.reduce((sum, file) => sum + file.rules.length, 0);
    const pathCount = parsedFiles.reduce((sum, file) => sum + file.filePaths.length, 0);
    const commandCount = parsedFiles.reduce((sum, file) => sum + file.commands.length, 0);
    console.log(pc.dim(`\nFound ${files.length} rules files. ${ruleCount} rules, ${pathCount} path references, ${commandCount} commands.`));

    const issues = runChecks({ root: path.resolve(dir), files: parsedFiles });
    const visibleIssues = issues.filter((issue) => options.verbose || issue.severity !== "info");
    const problems = issues.filter((issue) => issue.severity !== "info");
    const root = path.resolve(dir);
    const grouped = new Map<string, typeof visibleIssues>();
    for (const issue of visibleIssues) {
      const file = path.resolve(root, issue.file);
      const label = path.relative(root, file) || path.basename(file);
      const group = grouped.get(label) ?? [];
      group.push(issue);
      grouped.set(label, group);
    }
    for (const [label, fileIssues] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`\n${label}`);
      for (const issue of fileIssues.sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId))) {
        const color = issue.severity === "error" ? pc.red : issue.severity === "warning" ? pc.yellow : pc.dim;
        const line = String(issue.line).padStart(4);
        console.log(`  ${line}  ${color(issue.severity.padEnd(severityWidth))} ${issue.message}  ${pc.dim(issue.ruleId)}`);
      }
    }
    if (problems.length === 0) {
      console.log(pc.green("No problems found."));
      return;
    }
    const errors = problems.filter((issue) => issue.severity === "error").length;
    const warnings = problems.filter((issue) => issue.severity === "warning").length;
    console.log(`\n${problems.length} problems (${errors} errors, ${warnings} warnings)`);
    if (errors > 0) process.exitCode = 1;
  });

await program.parseAsync(process.argv);
