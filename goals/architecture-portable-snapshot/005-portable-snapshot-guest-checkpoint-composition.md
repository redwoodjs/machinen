# Goal 005: Portable snapshot plus guest checkpoint composition proof

## Motivation

Machinen's portable snapshot layer and in-guest checkpointing should not
invalidate each other. Users may have checkpoint images or checkpoint-capable
tooling inside a VM. We need to prove a supported Machinen snapshot/restore cycle
preserves that guest-level capability and supported guest storage.

## Objective

Prove that guest checkpointing works before and after a Machinen snapshot/restore,
and that guest-created checkpoint images stored on supported guest storage remain
readable.

## Required proof

- [x] Boot a Machinen VM.
- [x] Run a guest checkpoint/restore proof before Machinen snapshot.
- [x] Store a guest-created checkpoint image on supported guest storage.
- [x] Snapshot and restore the Machinen VM through the supported Machinen path.
- [x] Run the guest checkpoint/restore proof again after Machinen restore.
- [x] Verify the prior guest-created checkpoint image remains readable after Machinen
      restore.
- [x] Record source architecture and target architecture.
- [x] Record whether the Machinen restore was same-arch VM state, cross-arch
      semantic restore, or another explicitly labeled supported path.

## Machine-readable output

Each summary row must include:

- `kind: machinen.architecture-portable-snapshot.portable-snapshot-guest-checkpoint-composition`
- `sourceArch`
- `targetArch`
- `machinenStateModel`
- `guestCheckpointVersion`
- `preSnapshotGuestCheckpointVerifier`
- `postRestoreGuestCheckpointVerifier`
- `storedCheckpointImageDigest`
- `storedCheckpointImageReadableAfterRestore`
- `migrationCompleted`
- refusal code/remediation when refused

## Non-goals

- Do not claim a source-ISA checkpoint image can restore on a different ISA.
- Do not claim raw source checkpoint image replay is a cross-architecture restore
  mechanism.
- Do not count a guest checkpoint demo as Machinen product support unless the outer
  Machinen restore path is also product-supported.

## Refusals

Refuse with stable wording when:

- guest storage containing the checkpoint image is unsupported or dirty;
- guest checkpoint capability is unavailable;
- Machinen restore would change ISA in a way that makes the stored checkpoint image
  non-restorable but the test tries to restore it anyway;
- verifier output is missing or ambiguous.

## Tests and smokes

- [x] Composition smoke with pre/post guest checkpoint proof.
- [x] Stored checkpoint image readability proof.
- [x] Negative test preventing cross-ISA checkpoint image restore claims.
- [x] Summary classification tests.

## Documentation

- [x] Explain the two layers: Machinen portable restore vs in-guest checkpoint.
- [x] Explain what is preserved and what is only readable/proven.
- [x] Explain cross-ISA checkpoint image limitations.

## Validation

Run and record timing for:

- [x] composition smoke;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
