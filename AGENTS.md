# Machinen — Agent Rules

## Testing

Before completing any work, you MUST run and pass:

1. Unit tests: `npx vitest run`
2. Workflows: `npx agent-ci run --all -q -p`

If either fails, fix the issue and re-run. Do not tell the user work is done until both pass.

## CI

- Always use `--quiet` (`-q`) when running agent-ci.
- Check all workflows with: `npx agent-ci run --all -q -p`
- **Never** pipe agent-ci through `2>&1`, `tail`, or any other pipe. agent-ci does not exit on its own — it stays attached after the run finishes. Run it as a background process and use the `Monitor` tool to stream its output, watching for a **pause event** that signals the run is complete. Only then read results.

## Code

- Node.js ESM + TypeScript. Use `import`, not `require`.
- Package manager is pnpm (pinned via `packageManager` in package.json).
- The user authenticates via OAuth (`gh auth login`), never API keys.

## FUSE ops (mount-server)

When you wire up a new FUSE opcode in `packages/runtime/src/mount-server.ts`,
add its tests in the same change to `mount-server.test.ts`:

1. **Happy path** — the op succeeds and the host fs reflects the change.
2. **Error path** — the op returns the right errno (`ENOENT`, `EEXIST`,
   `EBADF`, etc.) for the expected failure modes.
3. **`:ro` gate** — if the op is mutating, assert it returns `EROFS` on a
   read-only mount and never touches the host fs.
4. **Wedge guard** — wrap the call in `raceWithDeadline()` so a hang
   becomes a fast test failure instead of a stuck CI run.

If you remove an op from the dispatch (intentionally going back to
`ENOSYS`), move it into the `UNIMPLEMENTED_OPS` table at the top of the
test file so its `ENOSYS`-within-deadline assertion stays in CI.
