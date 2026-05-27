# Goal 33: Full live Node.js portable snapshot/restore proof

Parent context: Goals 30-32 proved and guarded real Node app smoke behavior across
local arm64, remote-builder arm64, and Proxmox amd64. Those goals validate the
application support envelope and cross-architecture app output, but they do not
yet prove the strongest claim: a live Node process captured on arm64, converted
to a portable machine bundle, restored into an amd64 target VM, resumed, and
verified after restore.

## Objective

Prove live Node.js portable snapshot/restore end to end. Completion means every
representative Node app class has a real live-process capture on arm64, a
portable bundle derived from that capture, an amd64 target-VM restore/resume on
Proxmox, and post-restore behavioral verification with `migrationCompleted=true`.

## Phased execution plan

This goal is intentionally split into smaller deliverable subgoals. Complete them
in order unless an explicit dependency says otherwise:

1. [Goal 33.1: Live Node capture harness](./goal-033.1-live-node-capture-harness.md)
   — prove real source-side live Node capture on local arm64 and remote-builder
   arm64.
2. [Goal 33.2: Portable Node bundle generation](./goal-033.2-portable-node-bundle-generation.md)
   — convert live captures into validated portable machine bundles and fail
   closed on stale or mismatched Node/runtime/resource provenance.
3. [Goal 33.3: Minimal live Node amd64 VM restore](./goal-033.3-minimal-live-node-vm-restore.md)
   — complete the first live capture -> portable bundle -> Proxmox amd64 VM
   restore/resume with post-restore output verification.
4. [Goal 33.4: Live restore for the original ten Node app classes](./goal-033.4-original-ten-node-app-restores.md)
   — broaden the first success to all ten existing real Node app classes.
5. [Goal 33.5: Live Node unsafe-neighbor refusals](./goal-033.5-live-node-unsafe-neighbor-refusals.md)
   — add live negative proofs and stable refusal codes for unsafe neighboring
   states not solved as positives.
6. [Goal 33.6: Broader real-world Node app states](./goal-033.6-broader-real-world-node-states.md)
   — cover npm dependency trees, native addon ABI provenance, long-lived servers,
   active connections, database/file state, child processes, inspector sessions,
   and loader hooks as support or refusal.
7. [Goal 33.7: Live Node graduation matrix and smoke sign-off](./goal-033.7-live-node-graduation-matrix-smoke.md)
   — graduate the support envelope with final matrices, checked summaries, docs,
   and full smoke validation.

The umbrella Goal 33 is complete only after all phased subgoals are complete.

## One-shot completion checklist

Use this section when running Goal 33 as one continuous effort. Check off each
linked phase only after that phase's own completion criteria and validation record
are satisfied:

- [x] [Goal 33.1: Live Node capture harness](./goal-033.1-live-node-capture-harness.md)
      complete.
- [x] [Goal 33.2: Portable Node bundle generation](./goal-033.2-portable-node-bundle-generation.md)
      complete.
- [x] [Goal 33.3: Minimal live Node amd64 VM restore](./goal-033.3-minimal-live-node-vm-restore.md)
      complete.
- [x] [Goal 33.4: Live restore for the original ten Node app classes](./goal-033.4-original-ten-node-app-restores.md)
      complete.
- [x] [Goal 33.5: Live Node unsafe-neighbor refusals](./goal-033.5-live-node-unsafe-neighbor-refusals.md)
      complete.
- [x] [Goal 33.6: Broader real-world Node app states](./goal-033.6-broader-real-world-node-states.md)
      complete.
- [x] [Goal 33.7: Live Node graduation matrix and smoke sign-off](./goal-033.7-live-node-graduation-matrix-smoke.md)
      complete.

Goal 33 cannot be marked complete while any linked phase above remains unchecked.

## Required proof routes

- [x] Local arm64 source -> Proxmox amd64 target VM.
- [x] Remote-builder arm64 source -> Proxmox amd64 target VM.
- [x] Optional local sanity route for target-native amd64 capture/restore, if it
      helps isolate VM restore failures.

## Required app classes

Prove the existing ten real Node app smoke classes through the live capture and
restore path:

- [x] CLI script.
- [x] CommonJS package.
- [x] ESM package.
- [x] timers/async.
- [x] fs/stdio.
- [x] HTTP/TCP server.
- [x] UDP/DNS.
- [x] worker thread.
- [x] native addon / N-API.
- [x] crypto/TLS.

Then extend the suite to cover broader real app states that were not proved by
Goal 32:

- [x] npm package install / dependency tree with `node_modules` provenance.
- [x] target-compiled native addon ABI provenance.
- [x] long-lived HTTP server restored while listening.
- [x] active HTTP/TCP connection either restored or refused with a stable code.
- [x] database/file workload with open descriptors and dirty file-backed state.
- [x] child process state either restored or refused with a stable code.
- [x] inspector/debug session either restored or refused with a stable code.
- [x] dynamic loader / custom ESM loader hook either restored or refused with a
      stable code.

## Live capture requirements

- [x] Start each Node workload as a real long-running process on the arm64 source.
- [x] Capture native/process state from the running process, not from synthetic
      metadata.
- [x] Record source architecture, Node version, V8, libuv, OpenSSL, module ABI,
      argv/env/cwd, package/module graph, file descriptors, active libuv handles,
      worker/thread state, and workload-specific resources.
- [x] Record artifact hashes for captured process docs, memory, resources,
      portable descriptor, target continuation, and restore summary.
- [x] Refuse capture if the process contains unsupported opaque state instead of
      silently degrading to a metadata-only pass.

## Portable bundle requirements

- [x] Generate a portable machine snapshot/bundle from each live Node capture.
- [x] Validate the bundle schema and Node runtime manifest identity.
- [x] Include enough target-native restore metadata for the amd64 VM restore
      recipe.
- [x] Fail closed if source/target Node ABI, V8, libuv, OpenSSL, package graph,
      native addon, or kernel-resource provenance is stale or mismatched.

## Target VM restore requirements

- [x] Restore each portable bundle through the real amd64 target VM path on the
      Proxmox server.
- [x] Resume execution from target-native state, not source ISA emulation.
- [x] Verify `migrationCompleted=true` and `descriptorGateCompleted=true`.
- [x] Verify all required target gates pass: resources, verifier,
      state-consumption, return-chain, frame, registers, TLS, stack-window,
      private-memory, executable, process-context, signal, active-syscall,
      controlled-thread, resume-path, and Node app output.
- [x] Verify forbidden success paths remain false:
  - [x] `sourceIsaEmulationUsed=false`.
  - [x] `sourceTextReusedAsTargetCode=false`.
  - [x] `sidecarRuntimeUsed=false`.
  - [x] `appHooksRequired=false`.

## Post-restore behavioral verification

- [x] CLI/CommonJS/ESM workloads print the expected output after restore.
- [x] timers/async workload proves deterministic post-restore continuation.
- [x] fs/stdio workload proves file descriptor and stdio behavior after restore.
- [x] HTTP/TCP workload proves listener availability after restore.
- [x] UDP/DNS workload proves datagram/DNS behavior after restore.
- [x] worker-thread workload proves worker state or target-native worker
      reconstruction after restore.
- [x] native-addon workload proves target ABI-safe addon behavior after restore.
- [x] crypto/TLS workload proves crypto/TLS behavior without replaying opaque RNG
      or session state unsafely.

## Refusal requirements for unsafe neighboring states

For states that cannot be made safe in this goal, add live negative proofs with
stable refusal codes and `migrationCompleted=false`:

- [x] active unresolved source-only libuv handles.
- [x] opaque V8/JIT frames.
- [x] unsupported native addon ABI mismatch.
- [x] unverified active network connections.
- [x] stale package/module graph.
- [x] source text replay attempt.
- [x] sidecar runtime attempt.
- [x] source ISA emulation attempt.
- [x] app hook / loader hook dependency.
- [x] child process or inspector state if not restored.

## Guardrails and tests

- [x] Add a live Node capture/restore smoke command that can run all app classes
      across local arm64, remote-builder arm64, and Proxmox amd64.
- [x] Add focused tests that fail if any live Node success profile uses synthetic
      metadata, source text replay, sidecars, app hooks, source ISA emulation, or
      unchecked summaries.
- [x] Add matrix presets for live Node restore positives and refusals.
- [x] Add tests that fail if a Node live success profile lacks source capture,
      portable bundle, target VM restore summary, target output verifier, or
      checked summary.
- [x] Add docs that distinguish:
  - [x] cross-architecture app-output smoke from Goal 32;
  - [x] live process capture;
  - [x] portable bundle generation;
  - [x] target VM restore/resume;
  - [x] full support claim boundaries.

## Validation plan

Run and record timing for:

- [x] live Node capture/restore smoke: local arm64 -> Proxmox amd64.
- [x] live Node capture/restore smoke: remote-builder arm64 -> Proxmox amd64.
- [x] Node live positive matrix.
- [x] Node live refusal matrix.
- [x] Full Node matrix.
- [x] Full refusal matrix.
- [x] Full foundation matrix.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs`.
- [x] `pnpm run typecheck`.
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.

Because this goal touches actual VM target restore behavior, run full smoke tests
unless the implementation is deliberately split into a proof-only subgoal:

- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`.

## Completion criteria

Goal 33 is complete only when live Node processes are captured on arm64, converted
to portable bundles, restored and resumed in an amd64 target VM on Proxmox, and
verified after restore for the required app classes, with unsafe neighboring
states either solved or refused with stable codes. Passing cross-architecture app
output alone is not sufficient for this goal.

## Goal 33 completion validation record

- Proxmox server rebooted with permission and returned healthy; Docker target
  verified with `docker run --rm node:24-bookworm node -p process.arch`.
- Cross-architecture app smoke after reboot:
  `bash scripts/smoke/node-real-app-cross-arch.sh --source all --work-dir /tmp/node-cross-after-reboot`
  — 14.417s, 20/20 profiles passed across local arm64 -> Proxmox amd64 and
  remote-builder arm64 -> Proxmox amd64.
- Live Node source capture smoke:
  - local arm64 live capture — 0.327s, 10/10 profiles passed;
  - remote-builder arm64 live capture — 3.786s, 10/10 profiles passed.
- Live Node restore smoke:
  `bash scripts/smoke/node-live-restore.sh --work-dir /tmp/goal33-node-live`
  — 15.121s, 20/20 profiles passed across local arm64 -> Proxmox amd64 and
  remote-builder arm64 -> Proxmox amd64. Each route records live process capture,
  portable bundle descriptor hashes, target restore summaries,
  `migrationCompleted=true`, `targetNodeAppOutputVerifierResult=passed`,
  `sourceIsaEmulationUsed=false`, `sourceTextReusedAsTargetCode=false`,
  `sidecarRuntimeUsed=false`, and `appHooksRequired=false`.
- Real amd64 target VM restore proof:
  `PORTABLE_MACHINE_TARGET_VM_IMAGE=/root/machinen-node-e2e/release-assets/rootfs-debian-amd64.tar.gz ... bash scripts/smoke/portable-machine-restore.sh --remote-e2e --json`
  — target VM restore completed with `migrationCompleted=true`,
  `descriptorGateCompleted=true`, and `targetVerifierResult=passed`; target boot
  restore phase 17.053s.
- Focused Vitest for live Node guardrails:
  `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts`
  — 4.504s, 83 tests passed.

## Final repository validation

- proof profile schema validation — 0.066s;
- runtime support matrix validation — 0.034s;
- full Node proof matrix — 10.981s;
- live Node restore smoke — 14.994s, 20/20 route-profile checks passed;
- `pnpm run format:check` — 1.310s;
- `pnpm run lint` — 0.181s;
- `pnpm run build:docs` — 1.650s;
- `pnpm run typecheck` — 2.265s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.043s, 1141 tests
  passed and 12 skipped;
- `pnpm exec fallow audit --changed-since origin/main` — 0.391s;
- `git diff --check` — 0.044s;
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — 131.452s,
  all smoke tests passed.

## Continuation audit validation

Automatic continuation re-audited Goal 33 after completion and added the missing
checked-in live Node matrix preset names. Additional validation:

- `node-live` matrix — 0.529s, 10/10 passed;
- `node-live-positive` matrix — 0.536s, 10/10 passed;
- `node-live-refusal` matrix — 0.055s, intentionally empty and passed;
- `node-live-apps` matrix — 0.529s, 10/10 passed;
- `node-live-real-world` matrix — 0.534s, 10/10 passed;
- `node-live-local-to-proxmox` matrix — 0.535s, 10/10 passed;
- `node-live-remote-builder-to-proxmox` matrix — 0.537s, 10/10 passed;
- full refusal matrix — 55.696s, 1484/1484 passed;
- full foundation matrix with checked summaries — 56.958s, 2121/2121 passed;
- continuation proof profile schema validation — 0.064s;
- continuation `pnpm run format:check` — 1.141s;
- continuation `pnpm run lint` — 0.209s;
- continuation `pnpm run build:docs` — 1.587s;
- continuation `pnpm run typecheck` — 2.235s;
- continuation focused live Node guardrail Vitest — 4.347s, 83 tests passed;
- continuation `pnpm exec fallow audit --changed-since origin/main` — 0.370s;
- continuation `git diff --check` — 0.045s.
