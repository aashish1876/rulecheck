# rulecheck project rules

## Stack

rulecheck is an ESM TypeScript CLI for Node.js 18+. It uses tsup to build,
Vitest for tests, Commander for CLI arguments, fast-glob for file discovery,
mdast-util-from-markdown for Markdown parsing, and picocolors for terminal
colors.

## Structure

- `src/cli.ts`: CLI entry point and command setup
- `src/discover.ts`: rules file discovery
- `src/parse.ts`: Markdown parsing and reference extraction
- `src/types.ts`: shared data types
- `src/checks/`: future lint checks
- `tests/`: unit tests and fixtures

## Development

- Run `npm run build` to build the CLI.
- Run `npm test` to execute tests.
- Run `npm run lint` to type-check the project.

## Rules

- Keep functions small and typed.
- Every new feature needs tests.
- Prefer simple code over clever code.
