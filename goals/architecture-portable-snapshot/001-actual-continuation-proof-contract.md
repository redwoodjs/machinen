# Goal 001: Actual architecture-portable continuation proof contract

Parent roadmap issue: https://github.com/redwoodjs/machinen/issues/810

Concrete tracking issues:

- https://github.com/redwoodjs/machinen/issues/811 — opposite-ISA boundary
- https://github.com/redwoodjs/machinen/issues/812 — target-native execution
- https://github.com/redwoodjs/machinen/issues/813 — portable snapshot bundle source of truth
- https://github.com/redwoodjs/machinen/issues/814 — target process advances from captured state
- https://github.com/redwoodjs/machinen/issues/815 — source-ISA emulation refusal
- https://github.com/redwoodjs/machinen/issues/816 — raw checkpoint replay refusal
- https://github.com/redwoodjs/machinen/issues/817 — sidecar-only output refusal
- https://github.com/redwoodjs/machinen/issues/818 — metadata-only shortcut refusal
- https://github.com/redwoodjs/machinen/issues/819 — unsupported-state refusal inventory
- https://github.com/redwoodjs/machinen/issues/820 — live migration completion gate

## Objective

Create and enforce the contract for any row that claims an actual
architecture-portable continuation.

Goal 010 / PR #809 proved this contract for one controlled C profile. This goal
turns that contract into the reusable bar for future profiles and product work.

## Required contract

A successful actual continuation must satisfy all of these requirements:

- [x] Source and target ISA differ.
- [x] Target execution is native.
- [x] State comes from an architecture-portable snapshot bundle.
- [x] The target process continues from captured state.
- [x] Source-ISA emulation is refused and cannot count as success.
- [x] Raw checkpoint replay is refused and cannot count as success.
- [x] Sidecar-only output is refused and cannot count as success.
- [x] Metadata-only continuation is refused and cannot count as success.
- [x] Unsupported state is refused, not ignored.
- [x] `migrationCompleted=true` is allowed only after a live opposite-ISA
      target-native proof.

## Implementation checklist

### 1. Opposite-ISA boundary

- [x] Every continuation row records `sourceArch` and `targetArch`.
- [x] Validation fails when `sourceArch === targetArch` for completed
      continuations.
- [x] Same-ISA rows are allowed only as fixtures, same-ISA restore claims, or
      refusals.
- [x] Docs explain the distinction between same-ISA restore and
      architecture-portable continuation.

### 2. Target-native execution

- [x] Every completed continuation row records `targetExecution: native`.
- [x] Validation rejects `migrationCompleted=true` with emulated, skipped,
      refused, or not-applicable execution.
- [x] Target-side evidence identifies the target machine architecture.
- [x] Emulated routes stay classified as diagnostics, refusals, skips, or
      proof-only non-continuation evidence.

### 3. Portable snapshot bundle source of truth

- [x] Define the required bundle file list in code.
- [x] Bundle includes manifest, state payload, target artifact provenance,
      verifier contract, refusal records, and stable digests.
- [x] Include stable digests for every restore-affecting file, including
      `target.env` or its replacement.
- [x] Bundle validation fails closed on missing, malformed, or tampered files.
- [x] Restore code consumes the bundle as the source of continuation state, not
      host-side defaults.

### 4. Target process advances from captured state

- [x] Source capture records a verifier-observable state value.
- [x] Target restore passes that captured state to a target-native process.
- [x] Target verifier output includes both captured state and restored/next
      state.
- [x] Validation fails if the target ignores captured state.
- [x] Validation fails if the target reports the wrong next state.

### 5. Source-ISA emulation refusal

- [x] Bundle and row metadata expose whether source-ISA emulation was used.
- [x] The emulation flag must be false for success.
- [x] Validation rejects completed rows that used source-ISA emulation.
- [x] Negative smoke or fixture coverage proves emulation-marked evidence cannot
      set `migrationCompleted=true`.

### 6. Raw checkpoint replay refusal

- [x] Bundle and row metadata expose whether raw checkpoint replay was used.
- [x] The raw replay flag must be false for success.
- [x] Validation rejects completed rows that replay raw source checkpoint images.
- [x] Guest checkpoint artifacts remain proof inputs only unless translated or
      logically restored.

### 7. Sidecar-only output refusal

- [x] Successful rows identify the target-side verifier command/output path.
- [x] Sidecar-only output is classified as refused.
- [x] Validation rejects sidecar-only evidence with `migrationCompleted=true`.
- [x] Negative smoke proves sidecar output receives a stable refusal code.

### 8. Metadata-only shortcut refusal

- [x] Successful rows include target process verifier output.
- [x] Metadata-only continuation is classified as refused.
- [x] Validation rejects `migrationCompleted=true` without target verifier
      evidence.
- [x] Negative smoke proves metadata-only success receives a stable refusal code.

### 9. Unsupported-state refusal inventory

- [x] Define required unsupported-state categories for continuation profiles.
- [x] Each profile includes an unsupported-state inventory.
- [x] Unsupported categories carry stable refusal codes and remediation.
- [x] Validation fails if required state categories are missing.
- [x] Docs list continued, recreated, ignored-as-irrelevant, and refused state
      separately.

### 10. Live migration completion gate

- [x] Fixture/local-only runs always keep `migrationCompleted=false`.
- [x] Live runs require opposite ISA, target-native execution, and target verifier
      output.
- [x] Refused, skipped, emulated, sidecar-only, metadata-only, and raw-replay rows
      never set `migrationCompleted=true`.
- [x] Final gauntlet stores live proof evidence for any completed migration row.

## Validation checklist

Run and record timings for the smallest checks that cover the implemented work:

- [x] `pnpm run format:check`
- [x] `pnpm run lint`
- [x] `pnpm run build:docs` when public APIs or docs change
- [x] `pnpm run typecheck`
- [x] Targeted Vitest for changed validators/smokes, or full
      `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` when broad behavior
      changes
- [x] Relevant fixture/negative smokes
- [x] Live opposite-ISA smoke when `migrationCompleted=true` behavior changes
- [x] `pnpm exec fallow audit --changed-since origin/main`

## Completion criteria

This goal is complete when the reusable proof contract is enforced by code,
tests, smokes, docs, and the architecture-portable snapshot gauntlet. Future
profiles may then use this single goal as the acceptance bar for claiming actual
architecture-portable continuation.
