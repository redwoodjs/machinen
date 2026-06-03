# Machinen — Agent Rules

## Testing

Before completing work, run the smallest validation set that directly covers the
changed behavior, plus the relevant static checks. Report timing for every
validation command you claim passed.

Default validation for TypeScript/runtime/docs changes:

1. Format: `pnpm run format:check`
2. Lint: `pnpm run lint`
3. Docs/API when public exports or docs changed: `pnpm run build:docs`
4. Typecheck: `pnpm run typecheck`
5. Unit tests: `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`
6. Architecture audit for code changes: `pnpm exec fallow audit --changed-since origin/main`

Use targeted tests/proofs when the change is narrow. For example, native
synthetic syscall work should run the focused Vitest files plus the arm64 capture
and amd64 target proof, rather than the full VM smoke suite.

Run full smoke tests with
`MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` only when the
change touches VM lifecycle, VMM, rootfs/base assets, CLI boot/exec/mount,
snapshot/restore, virtio devices, memory/ballooning, FUSE/live mounts, or when
the user explicitly asks for broad end-to-end validation. If full smoke tests are
skipped, state why and list the targeted validation that covers the change.

If any required or chosen validation fails, fix the issue and re-run the failing
command plus any dependent checks.

## CI

- Do not run Agent CI by default. Run it only when workflow/CI files changed or
  when the user explicitly asks for it.
- When running agent-ci, always use `--quiet` (`-q`).
- Check all workflows with: `NPM_CONFIG_USERCONFIG=/dev/null npx agent-ci run --all -q -p`
- **Never** pipe agent-ci through `2>&1`, `tail`, or any other pipe. agent-ci does not exit on its own — it stays attached after the run finishes. Run it as a background process and use the `Monitor` tool to stream its output, watching for a **pause event** that signals the run is complete. Only then read results.

## Code

- Node.js ESM + TypeScript. Use `import`, not `require`.
- Package manager is pnpm (pinned via `packageManager` in package.json).
- The user authenticates via OAuth (`gh auth login`), never API keys.

## Snapshot/restore architecture

- Never implement snapshot/restore as runtime-level profiles (Node/V8/libuv,
  Python runtime profiles, JVM runtime profiles, etc.). Runtime profile routes
  are not an acceptable product path for Machinen snapshot/restore.
- Cross-architecture snapshot/restore work must be based on captured source
  machine/process state and target-native reconstruction/translation of that
  state, not app-exported state, checkpoint hooks, selected-state descriptors,
  sidecar replay, source-ISA emulation, or metadata-only success.
- Harnesses may exist as regression proofs, but they must be labeled as harness
  proofs and must not claim product support, Level 5 implementation, or broad
  runtime support.

## arm64 builds

When a step needs to run inside a `linux/arm64` docker image (rootfs,
kernel, anything compiled in-container), set
`MACHINEN_REMOTE_BUILDER=friend@100.126.46.90` and let the build
script delegate over ssh. Native-arm64 there finishes in ~3 min vs.
~15–20 min under qemu-arm64 emulation locally on an M-series mac.

## FUSE ops (live mounts)

The transport-agnostic FUSE opcode handlers live in
`packages/mount-server/src/fuse.zig`. The in-VMM virtio-fs device
(`packages/microvm/src/virtiofs.zig`) is the sole consumer — there is
no standalone mount-server process anymore (#338).

When you wire up a new FUSE opcode in `fuse.zig`, add its tests in the
same change. `fuse.zig` has dispatch-level tests; `virtiofs.zig` has
end-to-end tests that drive the op through a fake virtqueue against a
real host directory. Cover:

1. **Happy path** — the op succeeds and the host fs reflects the change.
2. **Error path** — the op returns the right errno (`ENOENT`, `EEXIST`,
   `EBADF`, etc.) for the expected failure modes.
3. **`:ro` gate** — if the op is mutating, assert it returns `EROFS` on a
   read-only mount and never touches the host fs.
4. **Wedge guard** — a malformed / over-long descriptor chain must be
   acked fail-soft, never hang the VMM thread.

Write clearly.
The most important component of writing clearly is simply to have high standards for clarity. Then if you write something unclear, you notice, and ask: what did I mean to say? You can just keep doing this over and over. And if you have high standards for clarity, you will.
Having high standards for clarity is useful in lots of other kinds of work too. It's very useful when I'm advising startups at Y Combinator. I ask founders what they plan to do. Their initial answer is a muddy pool. Then we make it clear — not just what to say, but what to do.
