# macOS guest provider plan

Add opt-in macOS guests to the Machinen TypeScript and CLI workflow without
changing Linux defaults. One signed Swift runner process per macOS VM owns the
Virtualization.framework lifetime, SSH carries commands and files, and the
existing registry keeps a real per-VM PID.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A
nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a test run, or a SHA. The body is a how-to, one Diátaxis mode, with appendices holding explanation and reference.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

The program runs `playbooks/feature.md`. The operator merges. Every PR is
delivered as an ordered commit stack on `feat/macos-guest-provider`.

Tests alone are not sufficient verification. A PR is verified only when its
unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [x] State the protocol and this plan to the operator.
- [x] Save the durable program objective. Read the installed pstack plugin at
      `/Users/bytedance/code/pstack-codex/plugins/pstack` and follow
      `poteto-mode` plus `playbooks/feature.md`.
- [x] Branch `feat/macos-guest-provider` off `main` at `457d9388`. Never edit
      `main`.
- [x] Record that the installed pstack plugin is source-only here, so execution
      uses this host's delegation tools with pstack model roles substituted by
      what the active provider exposes.
- [x] Skip the hourly audit tick. Reason. This is a single-session feature run,
      not a standing multi-day program, and scheduling is unavailable.
- [x] Skip the status message tick. Reason. Covered by the final operator
      report and the coordinating thread handoff.

### Spawn owners

- [x] Spawn one owner for the whole code-coupled change. The seam, registry,
      transport, CLI, and runner share one data shape, so parallel writers
      would serialize on the same files.
- [x] Keep verification work disjoint so it can run in parallel.
- [x] Hold the file boundaries. The owner touches only `packages/runtime/src`,
      `packages/cli/src`, `packages/native-arm64-darwin`, and
      `scripts/runtime-native-boundary-check.mjs`.
- [x] Skip the review gate. Reason. This is a headless CLI surface with no
      interaction change, so no screenshots or video are produced.

### PR mechanics

- [x] Resolve the forge. `gh` is authenticated for `ScriptedAlchemy`.
- [x] Open the PR ready, never draft, per **Opening a PR**.
- [x] Run the repo lint and typecheck once before the PR-facing push.
- [x] Run a focused diff cleanup pass before each commit.

### Verdict and merge

- [x] One verifier at the final head, since the diff is a new opt-in path that
      cannot regress Linux.
- [x] The operator merges. This stack stops at merge-ready.

### Boot recipe

Each live lane runs at the PR head in its own worktree when it writes. Drive
through terminal tools.

- [x] `git fetch origin feat/macos-guest-provider` then check out the head SHA.
- [x] Run `pnpm run build` and confirm the CLI starts with `machinen --version`.
- [x] Deliver input only through CLI commands and the Vitest runner.
- [x] Save lane logs to `/tmp/swarm-macos-guest/worker-<n>/`.

## Provider seam and early dispatch (P1)

**Depends on.** None.

**Files.**

- [x] Create `packages/runtime/src/provider/types.ts`.
- [x] Create `packages/runtime/src/provider/select.ts`.
- [x] Edit `packages/runtime/src/errors.ts`.
- [x] Edit `packages/runtime/src/registry.ts`.
- [x] Edit `packages/runtime/src/vm/boot.ts`.
- [x] Edit `packages/runtime/src/vm/restore.ts`.
- [x] Edit `packages/runtime/src/vm/snapshot.ts`.
- [x] Edit `packages/runtime/src/vm/attach.ts`.

**Build.**

- [x] `GuestOS = "linux" | "macos"` and `ProviderId = "machinen-hvf" |
"machinen-kvm" | "apple-vz"` as separate axes, so the host and guest
      conflation in `VmstateBackend` is not repeated.
- [x] `GuestCapabilities` with one explicit boolean per operation.
- [x] `resolveGuestOS` defaults absent or legacy input to `linux`.
- [x] New codes `PROVIDER_UNSUPPORTED_OPERATION`,
      `PROVIDER_HOST_UNSUPPORTED`, `PROVIDER_IMAGE_INVALID`,
      `PROVIDER_READINESS_FAILED`, `PROVIDER_TRANSPORT_FAILED`.
- [x] `RegistryEntry.guestOS`, `.provider`, `.providerRef`, `.capabilities`
      optional so old entries keep Linux defaults.
- [x] `boot()` selects the provider before `prepareBootPlan`, so kernel, DTB,
      initramfs, ext4 materialization, gvproxy, stats, and vsock setup never run
      for a macOS guest.
- [x] `restore()` refuses a macOS provider explicitly, since `RestoreOptions`
      inherits the selector from `BootOptions`.
- [x] `performSnapshot` and `performFork` refuse macOS.
- [x] `attach()` rehydrates the provider and refuses capability gaps.

**You see.**

- [x] `machinen ls` on a pre-existing registry directory still lists Linux VMs.
- [x] `machinen boot --guest-os macos` without a bundle fails with a typed
      provider error before any kernel asset resolution.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `registry.test.ts` gains round-trip and legacy-default cases. Run
      `npx vitest run packages/runtime/src/__tests__/registry.test.ts`.
- [x] `provider-dispatch.test.ts` proves `resolveBaseKernel` is never reached
      for a macOS boot. Run
      `npx vitest run packages/runtime/src/__tests__/provider-dispatch.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Boot a Linux VM at trunk and at head and compare `machinen ls --json`. Save `screens/linux-ls-trunk.txt` and `screens/linux-ls-head.txt`. Pass when the head payload is identical apart from timestamps.
- [x] Lane 2. macOS refusal without a bundle. Run `machinen boot --guest-os macos -- true`. Save `screens/macos-no-bundle.txt`. Pass when it exits non-zero and the message names the missing bundle.
- [x] Lane 3. Unknown guest OS. Run `machinen boot --guest-os plan9 -- true`. Save `screens/unknown-os.txt`. Pass when it exits non-zero naming the allowed values.
- [x] Lane 4. Unknown provider. Run `machinen boot --provider lume -- true`. Save `screens/unknown-provider.txt`. Pass when it exits non-zero naming the allowed values.
- [x] Lane 5. Legacy registry entry. Seed a `meta.json` with no `guestOS` field, then run `machinen ls`. Save `screens/legacy-registry.txt`. Pass when the entry lists as a Linux VM and is not pruned.
- [x] Lane 6. Legacy attach. Attach by name to the seeded legacy entry. Save `screens/legacy-attach.txt`. Pass when the handle reports `guestOS linux` and does not throw.
- [x] Lane 7. Snapshot refusal. Run `machinen snapshot` against a macOS-provider entry. Save `screens/snapshot-refusal.txt`. Pass when it fails with `PROVIDER_UNSUPPORTED_OPERATION`.
- [x] Lane 8. Fork refusal. Run `machinen fork` against a macOS-provider entry. Save `screens/fork-refusal.txt`. Pass when it fails with the same code and mentions no fork parity.
- [x] Lane 9. Restore refusal. Run `machinen restore` with a macOS provider selected. Save `screens/restore-refusal.txt`. Pass when it fails before reading any Linux kernel or DTB asset.
- [x] Lane 10. Kernel asset isolation. Run the macOS boot with `MACHINEN_ASSETS_DIR` pointed at an empty directory. Save `screens/asset-isolation.txt`. Pass when the failure is the provider error, not a missing kernel or rootfs.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Linux boot wall time from process start to first guest byte.
- [x] Probe. `pnpm run bench-boot` at trunk and at head, interleaved.
- [x] Baseline. Record the trunk boot time first.
- [x] Rule. Head regresses when the median exceeds trunk by more than 5 percent.
      The seam adds one enum comparison before `prepareBootPlan`.

**Review gate.** None. P1 is not review-gated because it changes no interaction.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Operator squash-merges, or appends to the stack.

## macOS provider and CLI surface (P2)

**Depends on.** P1.

**Files.**

- [x] Create `packages/runtime/src/provider/macos/config.ts`.
- [x] Create `packages/runtime/src/provider/macos/runner-status.ts`.
- [x] Create `packages/runtime/src/provider/macos/ssh.ts`.
- [x] Create `packages/runtime/src/provider/macos/boot.ts`.
- [x] Create `packages/runtime/src/provider/macos/attach.ts`.
- [x] Create `packages/runtime/src/provider/macos/handle.ts`.
- [x] Edit `packages/cli/src/parse-run-args.ts`.
- [x] Edit `packages/cli/src/commands/boot.ts`.
- [x] Edit `packages/cli/src/agent-context.ts`.
- [x] Edit `packages/cli/src/help.ts`.

**Build.**

- [x] Validate Darwin and arm64 before anything spawns.
- [x] Validate the prepared bundle as a directory with a readable
      `config.json`, refusing IPSW, Lume, and Tart formats by name.
- [x] Readiness means the runner reports `running` and an SSH command succeeds,
      not that `start()` returned.
- [x] Commands and files go over SSH and SFTP with a managed `known_hosts`,
      `BatchMode=yes`, and no secret material in argv, logs, or registry JSON.
- [x] `--guest-os` and `--provider` parse as enums and reach `boot()`.
- [x] `cmdBoot` skips `resolveCliBaseAssets()` when the guest OS is macOS.
- [x] macOS boot rejects Linux-only flags before spawning.

**You see.**

- [x] `machinen boot --guest-os macos --image <bundle> --detach` prints a boot
      identity JSON line and registers a real runner PID.
- [x] `machinen exec <name> -- uname -s` prints `Darwin`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `provider-macos.test.ts` proves boot, readiness timeout, cleanup, and
      typed failures against a fake runner and fake SSH. Run
      `npx vitest run packages/runtime/src/__tests__/provider-macos.test.ts`.
- [x] `cli.test.ts` and `conventions.test.ts` pass. Run
      `npx vitest run packages/cli/src/__tests__/cli.test.ts
packages/cli/src/__tests__/conventions.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Boot a Linux VM with `machinen boot -- /bin/sh -c 'echo hi'` at trunk and head. Save `screens/linux-boot-trunk.txt` and `screens/linux-boot-head.txt`. Pass when both print `hi` and exit 0.
- [x] Lane 2. Agent context. Run `machinen agent-context` at head. Save `screens/agent-context.txt`. Pass when `--guest-os` and `--provider` appear with enum values.
- [x] Lane 3. Help text. Run `machinen --help` at head. Save `screens/help.txt`. Pass when the macOS flags are documented.
- [x] Lane 4. Dry run. Run `machinen boot --guest-os macos --dry-run` at head. Save `screens/dry-run.txt`. Pass when it prints the resolved plan and starts no process.
- [ ] Lane 5. macOS boot against a prepared bundle. Blocked on the bundle and SSH key. Save `screens/macos-boot.txt`. Pass when `uname -s` prints `Darwin`.
- [ ] Lane 6. Detach and reattach against a prepared bundle. Blocked on the bundle. Save `screens/reattach.txt`. Pass when a second process attaches by name and runs a command.
- [ ] Lane 7. Binary transfer against a prepared bundle. Blocked on the bundle. Save `screens/transfer.txt`. Pass when host and guest SHA-256 digests match.
- [x] Lane 8. Readiness timeout. Point the provider at a fake runner that never reports ready. Save `screens/readiness-timeout.txt`. Pass when the boot fails with `PROVIDER_READINESS_FAILED` inside the timeout and reaps the runner.
- [x] Lane 9. Linux-only flag rejection. Run `machinen boot --guest-os macos --nested -- true`. Save `screens/flag-rejection.txt`. Pass when it refuses before spawning anything.
- [x] Lane 10. Secret hygiene. Boot with a fake key path, then grep the registry JSON and the log. Save `screens/secret-hygiene.txt`. Pass when no key material or password appears in either.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Linux boot wall time, unchanged path.
- [x] Probe. `pnpm run bench-boot` at trunk and at head, interleaved.
- [x] Baseline. Record the trunk boot time first.
- [x] Rule. Head regresses when the median exceeds trunk by more than 5 percent.

**Review gate.** None. P2 is not review-gated because it changes no interaction.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Operator squash-merges, or appends to the stack.

## Native Swift runner (P3)

**Depends on.** P2.

**Files.**

- [x] Create `packages/native-arm64-darwin/vz-runner/Sources/main.swift`.
- [x] Create `packages/native-arm64-darwin/vz-runner/build.sh`.
- [x] Create `packages/native-arm64-darwin/vz-runner/entitlements.plist`.
- [x] Edit `packages/native-arm64-darwin/index.mjs`.
- [x] Edit `packages/native-arm64-darwin/package.json`.
- [x] Edit `scripts/runtime-native-boundary-check.mjs`.

**Build.**

- [x] One runner process per VM, PID recorded in the registry.
- [x] Runner writes a JSON status file the runtime polls.
- [x] Signing and entitlements are declared and verified in the build script.

**You see.**

- [x] `swift build` in the runner directory produces a signed executable that
      prints its version.
- [x] `pnpm run runtime-native-boundary-check` passes with the new export.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] `pnpm run runtime-native-boundary-check` passes.
- [x] `codesign --verify` on the built runner exits 0.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [x] Lane 1. Build lane. Run the built runner with `--version`. Save `screens/runner-version.txt`. Pass when it prints a version and exits 0.
- [x] Lane 2. Refusal lane. Run the runner with a non-bundle path. Save `screens/runner-refusal.txt`. Pass when it exits non-zero with a typed message.
- [x] Lane 3. Signature lane. Run `codesign --verify --strict` on the binary. Save `screens/codesign.txt`. Pass when it exits 0.
- [x] Lane 4. Entitlement lane. Dump the entitlements. Save `screens/entitlements.txt`. Pass when the virtualization entitlement is present and nothing broader is claimed.
- [x] Lane 5. Boundary lane. Run `pnpm run runtime-native-boundary-check`. Save `screens/boundary.txt`. Pass when it reports the new export and valid roles.
- [x] Lane 6. Export lane. Read `index.mjs` from Node and print the new export. Save `screens/export.txt`. Pass when the path resolves to the built runner.
- [x] Lane 7. Package manifest lane. Parse `package.json#bin`. Save `screens/package-bin.txt`. Pass when the runner is listed next to the existing binaries.
- [x] Lane 8. Status file lane. Start the runner against a fake bundle and read the status file. Save `screens/status-file.txt`. Pass when it is valid JSON with a `state` field.
- [x] Lane 9. Single-instance lane. Start two runners on the same bundle path. Save `screens/lock.txt`. Pass when the second exits non-zero on the lock.
- [x] Lane 10. Non-arm64 lane. Run the runner with an arm64 override forced off. Save `screens/arch-guard.txt`. Pass when it refuses with a typed host error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The runner is a new process with no trunk counterpart, so
      there is no baseline to compare.
- [x] Probe. Time `runner --version` over 10 runs at head.
- [x] Baseline. Record the head median as the future budget.
- [x] Rule. Fail the lane when the median exceeds 2 seconds, which would
      indicate the binary is loading the framework eagerly.

**Review gate.** None. P3 is not review-gated because it changes no interaction.

**Merge.**

- [x] Root's clean verdict at the exact head SHA.
- [x] Operator squash-merges, or appends to the stack.

## Hardware smoke (P4)

**Depends on.** P3.

**Files.**

- [x] n/a, this unit adds no files. It runs the existing CLI against a real
      guest.

**Build.**

- [x] n/a, no build step. The artifact is the measured run log.

**You see.**

- [ ] `uname -s` prints `Darwin` from a real macOS guest.
- [ ] Streamed stdout, stderr, and a nonzero exit code survive `machinen exec`.
- [ ] Binary file transfer round-trips byte-identical content.
- [ ] Detach, then reattach from a new process, then a graceful stop.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] n/a, unit coverage lands in P2. This unit is the hardware proof itself.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Headless boot against a prepared bundle. Save `screens/darwin.txt`. Pass when `uname -s` prints `Darwin`.
- [ ] Lane 2. Streams and exit status. Save `screens/streams.txt`. Pass when stdout, stderr, and the exit code all match the guest.
- [ ] Lane 3. Binary transfer. Save `screens/transfer-sha.txt`. Pass when the host and guest digests match.
- [ ] Lane 4. Detach and reattach. Save `screens/reattach.txt`. Pass when a new process attaches and runs a command.
- [ ] Lane 5. Graceful stop. Save `screens/stop.txt`. Pass when the runner exits 0 and the registry entry is removed.
- [ ] Lane 6. Force stop. Save `screens/force-stop.txt`. Pass when the runner is killed and no orphan remains.
- [ ] Lane 7. Multi-VM identity. Boot two macOS guests. Save `screens/two-vms.txt`. Pass when both hold distinct PIDs and names.
- [ ] Lane 8. PID recycling. Kill a runner and reuse the PID path. Save `screens/recycle.txt`. Pass when `machinen ls` prunes the stale entry.
- [ ] Lane 9. Readiness failure. Boot with a bad SSH key. Save `screens/bad-key.txt`. Pass when it fails with a transport error and leaves no runner.
- [ ] Lane 10. Image preservation. Note the bundle mtime before and after boot and stop. Save `screens/image-preserved.txt`. Pass when the prepared bundle is untouched.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Cold boot to SSH readiness for the macOS guest.
- [ ] Probe. Five boots, recorded in `boot-times.txt`.
- [ ] Baseline. Record the first measured median as the budget.
- [ ] Rule. n/a until a real bundle exists. No number is invented here.

**Review gate.** None. P4 is not review-gated because it changes no interaction.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Operator merges after the hardware evidence lands.

## Close the program

- [x] Every unblocked box checked with its evidence.
- [x] Reply with measured results separated from mocks and builds.

## Appendix A. Prototype evidence

No prototype was required. The design decisions follow from the source map at
`457d9388`, not from a behavioral fork.

## Appendix B. Alternatives rejected

| Alternative                                | Why it lost                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Swap only the VMM binary                   | macOS guests need no kernel, DTB, initramfs, or ext4 rootdisk, so `prepareBootPlan` must be skipped, not reconfigured |
| Shared Lume daemon PID as the registry key | Overwrites entries, breaks PID-recycling checks, and cannot express per-VM ownership                                  |
| Synthetic per-VM PID                       | Registry liveness is `kill(pid, 0)`, so a fake PID is either always dead or always alive                              |
| Reuse the Linux vsock exec agent           | The agents are Linux ELF binaries with no macOS ABI                                                                   |
| SSH PTY as persistent sessions             | SSH PTY is per-connection, not a reconnectable named session                                                          |
| Feed VZ saved state into Linux restore     | Different format and same-host encryption binding                                                                     |

## Appendix C. Risks

- No prepared bundle exists yet, so the Swift runner is compiled but not
  hardware-verified. It lands behind an explicit provider selector.
- Guest address discovery depends on the runner's lease reading, which needs a
  real boot to confirm.
- SSH key handling must never widen into password auth. The transport refuses
  anything but key-based `BatchMode`.

## Appendix D. Links and reading list

- Design source `/Users/bytedance/.t3/projects/macos-vm/docs/machinen-macos-vm-design.md`
- `packages/runtime/src/vm/boot.ts`, `registry.ts`, `errors.ts`
- `packages/cli/src/agent-context.ts`, `parse-run-args.ts`
- `scripts/runtime-native-boundary-check.mjs`
