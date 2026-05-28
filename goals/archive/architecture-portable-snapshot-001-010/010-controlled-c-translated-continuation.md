# Goal 010: Controlled C translated continuation

## Motivation

The previous goals built the architecture-portable snapshot proof ladder,
component proofs, refusals, and final checked gauntlet. The next milestone must
prove the first real target-native translated continuation: capture a controlled
workload on one ISA, restore it on the opposite ISA from portable state, and
verify continuation without source-ISA emulation or raw checkpoint image replay.

## Objective

Implement the first end-to-end architecture-portable snapshot restore for a
controlled static C counter/service profile.

The proof must show:

- source and target ISAs differ;
- target execution is native;
- restored state comes from an architecture-portable snapshot bundle;
- the target process continues from the captured logical state;
- no host sidecar output, source-ISA emulation, metadata-only shortcut, or raw
  checkpoint image replay is counted as success.

## Required subgoals

1. Define the controlled C continuation profile.
   - Static or otherwise fully provenance-checked target-native C artifact.
   - Explicit checkpoint/safe-point contract.
   - Minimal logical state, such as a counter value and continuation label.
   - Refusal inventory for unsupported files, sockets, threads, signals, timers,
     dynamic libraries, and runtime-private state.
2. Add runtime module:
   - `architecture-portable-controlled-continuation.ts`.
3. Add snapshot bundle builder/validator.
4. Add target restore loader script.
5. Add source capture script.
6. Add smoke:
   - local fixture mode;
   - live mode requiring remote opposite-ISA target.
7. Add gauntlet row for the new claim.
8. Run on real `arm64 -> amd64` or `amd64 -> arm64` target.
9. Only then mark `migrationCompleted=true`.

## Snapshot bundle requirements

The architecture-portable snapshot bundle must include:

- manifest with format version, source arch, target arch, state model, and target
  execution mode;
- source capture evidence;
- target artifact provenance and digest;
- continuation descriptor;
- logical state payload;
- refusal records for unsupported state categories;
- verifier command and expected verifier contract;
- stable artifact digests for every file that affects restore.

Suggested state model:

```txt
translated-controlled-continuation
```

## Target restore loader requirements

The target restore loader must:

- run on the target ISA;
- verify target architecture with a target-side command such as `uname -m`;
- verify target artifact digest/provenance;
- read and validate the continuation descriptor;
- materialize the target-native process using the captured logical state;
- emit verifier output proving continuation from the captured value;
- fail closed with stable refusal codes when the bundle, target artifact, or
  target environment is invalid.

## Machine-readable output

Add a checked row with:

- `claimId: controlled-c-translated-continuation`
- `classification: proof-only-feasibility | refused | skipped`
- `sourceArch`
- `targetArch`
- `hostArch`
- `providerMode`
- `targetExecution: native | not-applicable`
- `stateModel: translated-controlled-continuation`
- `stateDecisions`
- `verifierCommand`
- `verifierOutput`
- `artifactDigests`
- `provenance`
- `migrationCompleted`
- `refusalCode` and `remediation` when refused or skipped

`migrationCompleted=true` is allowed only after a live opposite-ISA target run
proves target-native continuation. Fixture-only or local-only runs must remain
`migrationCompleted=false`.

## Non-goals

- Do not claim arbitrary Linux process restore.
- Do not claim raw checkpoint image replay across ISA.
- Do not claim source-ISA emulation as target-native continuation.
- Do not require guest checkpoint tooling for this proof.
- Do not silently accept dynamic linker, thread, signal, timer, socket, or native
  library state unless it is explicitly modeled and verified.

## Tests and smokes

- [x] Unit tests for bundle schema validation.
- [x] Unit tests for refusal/invariant failures.
- [x] Unit tests for gauntlet row validation.
- [x] Local fixture smoke that builds and validates a bundle but does not claim
      migration completion.
- [x] Live smoke requiring a real opposite-ISA target.
- [x] Negative smoke proving sidecar output or metadata-only continuation is
      refused.

## Documentation

- [x] Explain the controlled C continuation contract.
- [x] Explain snapshot bundle contents and provenance.
- [x] Explain target restore loader behavior.
- [x] Explain why this is architecture-portable snapshot translation, not raw
      checkpoint replay.
- [x] Explain why fixture-only mode cannot set `migrationCompleted=true`.

## Validation

Run and record timing for:

- [x] local fixture smoke;
- [x] live opposite-ISA smoke on real `arm64 -> amd64` or `amd64 -> arm64`
      target;
- [x] targeted unit tests;
- [x] architecture-portable snapshot gauntlet;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs` when public APIs/docs changed;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` or a justified targeted
      subset;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
