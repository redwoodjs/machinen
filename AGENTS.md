# Machinen — Agent Rules

## Testing

Before completing any work, you MUST run and pass:

1. Unit tests: `npx vitest run`
2. Workflows: `npx agent-ci run --all -q -p`

If either fails, fix the issue and re-run. Do not tell the user work is done until both pass.

## CI

- Always use `--quiet` (`-q`) when running agent-ci.
- Run `/validate` to check all workflows: `npx agent-ci run --all -q -p`

## Code

- Node.js ESM + TypeScript. Use `import`, not `require`.
- Package manager is pnpm (pinned via `packageManager` in package.json).
- The user authenticates via OAuth (`gh auth login`), never API keys.
