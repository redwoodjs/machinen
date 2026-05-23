# Simplification

Our main goal is to **simplify**: fewer concepts per file, fewer lines per
module, logic in the right layer. Fallow helps, but it is not enough on its
own.

## Two tools, two axes

| Axis                | Tool                                | What it measures                             | What it misses                            |
| ------------------- | ----------------------------------- | -------------------------------------------- | ----------------------------------------- |
| Function complexity | [fallow](https://docs.fallow.tools) | Cyclomatic/cognitive complexity per function | File size, module boundaries, layer leaks |
| Module size & shape | `pnpm run check:file-sizes`         | Lines per source file                        | Whether the split was the right one       |

Fallow and simplification can **pull in opposite directions**. Extracting
helpers inside the same file lowers complexity scores but often **grows** the
file. PR #368 ("Reduce fallow health complexity") did exactly that:
`cli.ts` went from 2,215 → 2,839 lines and `boot.ts` from 1,897 → 2,279
while every function passed fallow thresholds.

**Rule:** when fallow asks you to extract logic, prefer a **new file** over
another helper in an already-large parent.

## Hard rules

1. **Do not grow a tracked file.** `pnpm run check:file-sizes` compares
   changed files against `fallow-baselines/file-sizes.json`. A PR that adds
   lines to a grandfathered file fails CI.

2. **Do not add files over 1,000 lines.** New modules must stay under the cap.

3. **Put behavior in the canonical layer.**
   - Runtime owns VM lifecycle (`boot`, `restore`, `stop`, `exec`, registry).
   - CLI parses args, calls runtime, formats output.
   - VMM owns guest execution; runtime supervises the VMM process.
   - See [CONTEXT.md](../../CONTEXT.md).

4. **Prefer deletion over rearrangement.** If a refactor moves code but does
   not remove branches, helpers, or duplicate lists, it is not simplification.

5. **One registry per concept.** Do not maintain parallel lists of the same
   names (e.g. `PAYLOAD_ASSETS` and a separate `ASSET_DESCRIPTIONS` map).
   Derive one from the other.

## PR checklist

Before opening or merging a PR, answer these:

- [ ] Did I **shrink or split** any file I touched that is already over 800
      lines? If not, why is staying in one file simpler?
- [ ] Did fallow extraction go into a **new module** when the parent is large?
- [ ] Is new orchestration in **runtime**, not CLI?
- [ ] Did I reuse an existing helper instead of adding a near-duplicate?
- [ ] `pnpm exec fallow audit --changed-since origin/main` passes
- [ ] `pnpm run check:file-sizes --changed-since origin/main` passes

## When fallow passes but the file is still too big

Split along **existing seams**, not arbitrary line ranges:

| File                                  | Split along                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/cli.ts`             | `COMMAND_HANDLERS` map → `commands/<verb>.ts`; asset download → `assets/`; shared attach session → `session.ts` |
| `packages/runtime/src/vm/boot.ts`     | Registry, networking/gvproxy, resource prep, cleanup                                                            |
| `packages/runtime/src/mkinitramfs.ts` | Library vs CLI entry (`mkinitramfs-cli.ts` or script)                                                           |
| `packages/microvm/src/boot_*.zig`     | Shared `boot_virtio.zig` + `boot_snapshot.zig`; backends keep hypervisor-specific code only                     |
| `packages/mount-server/src/fuse.zig`  | Per-opcode handler files; keep dispatch in `fuse.zig`                                                           |

Move **`stop()` from CLI to runtime** — it is lifecycle logic that belongs in
the canonical API.

## Decomposition backlog

Work top to bottom. Each item should **reduce line count** in the named file,
not just move complexity around inside it.

1. Split `cli.ts` by command; move `stop()` to runtime.
2. Split `boot.ts` into registry / network / resources / cleanup modules.
3. Extract `boot_virtio.zig` + `boot_snapshot.zig` from the three boot backends.
4. Fence native-research code out of `@machinen/runtime` (or make scripts
   import runtime modules — pick one canonical layer, not both).
5. Unify `connectWithRetry` in runtime (`vsock-client.ts`).
6. Unify image walking (`rootfs-img.ts` / `mountdisk-img.ts`).
7. Split `fuse.zig` handlers (keep tests co-located or in `fuse_tests.zig`).

Remove a file from the size baseline when it drops **below 1,000 lines**.

## Fallow hygiene

Fallow audit only checks **changed files**. It does not shrink untouched god
files.

Refresh baselines after a simplification pass so CI reflects reality:

```bash
pnpm exec fallow health --save-baseline fallow-baselines/audit-health.json
pnpm exec fallow dupes --save-baseline fallow-baselines/audit-dupes.json
pnpm run check:file-sizes --save-baseline
```

The health baseline currently lists complexity findings that no longer exceed
thresholds (post-#368). Refresh it so audit is not carrying ghost debt.

## Zig

Fallow does not analyze `.zig`. Large VMM files are reviewed manually against
the same rules: shared code in shared modules, no third copy of virtio/snapshot
loops.

## What not to do

- Big-bang rewrites with no behavior-preserving steps
- Merging boot backends into one file
- Moving FUSE transport back out of the VMM (#338)
- Abstracting identical native shippers across platforms — they should stay
  boring and separate

## Validation

```bash
pnpm exec fallow audit --changed-since origin/main
pnpm run check:file-sizes --changed-since origin/main
```

Both run in the default agent validation set ([AGENTS.md](../../AGENTS.md)).
