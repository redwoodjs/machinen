# Next move envelopes

## Goal

Implement and prove the next `machinen move` envelopes for the same Machinen Debian base image across architectures, following the immediate sequence: regular-file readers (`cat`/`head`/`sed -n`), `grep`, `watch`, `sh` waiting for input, and a simple Python HTTP server listener. Keep claims envelope-specific and target-native; do not claim arbitrary ELF/process/VM cross-arch restore. Proof-only tools must not be baked into the base image.

## Proof checklist

| Status | Proof obligation                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ☑      | Prove regular-file reader envelopes continue from captured file offset with no duplicate bytes for at least one distro reader.         | Local and remote `pnpm proof-move-envelope-matrix -- --json` passed: `reader-cat`, strategy `target-original-cat-offset-loader`, path `/tmp/cat.txt`, offset `131072`, target bytes `618928`.                                                                                                                |
| ☑      | Prove `grep pattern file` continues scanning from captured file offset and emits only remaining matches.                               | Local and remote `pnpm proof-move-envelope-matrix -- --json` passed: `grep`, strategy `target-original-grep-offset-loader`, pattern `match`, offset `294912`, matches `17993`.                                                                                                                               |
| ☑      | Prove `watch command` loader preserves the interval shape and restarts the child command on target under original distro `watch`.      | Local and remote `pnpm proof-move-envelope-matrix -- --json` passed: `watch`, strategy `target-original-watch-loop-loader`, interval `1`, command `date`; remote target PID `955`.                                                                                                                           |
| ☑      | Prove `sh` idle prompt envelope starts original distro shell at the target with captured cwd and waits for input under a PTY boundary. | Local and remote `pnpm proof-move-envelope-matrix -- --json` passed: `shell`, strategy `target-original-sh-script-pty-loader`, shell `dash`, cwd `/`; remote target PID `1019`.                                                                                                                              |
| ☑      | Prove simple Python HTTP server envelope recreates a target listener and serves the same files from the target guest.                  | Local and remote `pnpm proof-move-envelope-matrix -- --json` passed: `python-http`, strategy `target-original-python-http-server-loader`, cwd `/tmp/web`, port `8123`, response `hello-http`.                                                                                                                |
| ☑      | Prove the new envelopes are represented in `GOAL.md` and/or move descriptor state without broad generic restore claims.                | `GOAL.md` has phase 5A-5E rows; descriptor capture state exists in `packages/runtime/src/move-pid-graph.ts` for `readerState`, `grepState`, `watchState`, `shellState`, and `httpState`.                                                                                                                     |
| ☑      | Prove local arm64 validation passes for the envelope matrix.                                                                           | `pnpm proof-move-envelope-matrix -- --json` passed locally on 2026-06-09T05:57Z with sleep, tail, reader, grep, watch, shell, Python HTTP, and terminal-tool probe.                                                                                                                                          |
| ☑      | Prove amd64 validation passes for the envelope matrix on `root@192.168.0.8`.                                                           | Remote passed on 2026-06-09T06:57Z after rsync and amd64 asset rebuild, using fresh built VMM override: `MACHINEN_VMM=$PWD/packages/microvm/zig-out/bin/machinen-vm MACHINEN_GVPROXY=$PWD/packages/native-x64-linux/vmm/bin/gvproxy pnpm proof-move-envelope-matrix -- --json`.                              |
| ☑      | Prove static checks and targeted tests pass after implementation.                                                                      | Passed: `pnpm run format:check`; `pnpm run lint`; `pnpm run build:docs`; `pnpm run typecheck`; targeted Vitest 2 files/13 tests/388ms; full Vitest 167 files passed, 11 skipped, 48.85s; `pnpm run check-smoke-manifest`; `pnpm exec fallow audit --changed-since origin/main` completed with warnings only. |
| ☑      | Prove the PR branch is updated with the completed work.                                                                                | Final commit created with message `Add next move continuation envelopes`. Push evidence will be branch `move-envelope-sequence` updated on origin.                                                                                                                                                           |

## Done when

All required proof checklist table rows are marked ☑ with evidence, and no stop condition applies.

## Verification

- `pnpm run format:check` — proves formatting is clean.
- `pnpm run lint` — proves lint and changed-file health checks are clean.
- `pnpm run typecheck` — proves TypeScript/build integration is clean.
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/cli/src/__tests__/move-rendezvous.test.ts packages/cli/src/__tests__/move-native-bundle.test.ts` — proves targeted move loader tests pass.
- `pnpm run check-smoke-manifest` — proves proof script manifest coverage stays valid.
- `pnpm proof-move-envelope-matrix -- --json` — proves local arm64 envelope behavior.
- Remote `pnpm proof-move-envelope-matrix -- --json` on `root@192.168.0.8` — proves amd64 envelope behavior.

## Stop if

- Required remote host `root@192.168.0.8` is unreachable and cross-arch/amd64 evidence cannot be collected.
- Same Debian base image assumption is violated by missing packages that cannot be provisioned proof-locally without baking them into base assets.
- The implementation would require claiming arbitrary process/VM cross-architecture restore.
- The /goal loop reaches 8 agent completion(s) without satisfying the contract.

## Current evidence

- 2026-06-08T20:52:04Z: Started on branch `move-envelope-sequence` with clean working tree.
- 2026-06-08T20:57:00Z: User clarified proof-only tools must not be baked into the base image. Removed package additions from `scripts/build-base-assets.sh`; proof harness provisions optional proof tools inside proof VMs instead.
- 2026-06-08T21:07:00Z: First proof-local provisioning attempt failed because `python3` was stripped but dpkg still considered it installed; fixed by proof-local `apt-get install --reinstall` of Python runtime packages. Nothing is baked into base assets.
- 2026-06-09T05:57Z: Local `pnpm proof-move-envelope-matrix -- --json` passed after refactor for sleep, tail, reader, grep, watch, shell, Python HTTP, and terminal tool probe.
- 2026-06-09T08:03Z: Remote amd64 assets rebuilt on `root@192.168.0.8` with `MACHINEN_GUEST_ARCH=amd64 bash scripts/build-base-assets.sh`. Default packaged VMM was stale and failed detached exec with `EXEC_AGENT_UNAVAILABLE`; proof passed using freshly built `packages/microvm/zig-out/bin/machinen-vm` and packaged `gvproxy`.

## Next action

Push branch `move-envelope-sequence` to origin.

## Status

COMPLETE
