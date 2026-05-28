# Goal 005: Portable snapshot plus guest CRIU composition proof

Parent: [`FINAL-GOAL.md`](./FINAL-GOAL.md)

## Motivation

Machinen's portable snapshot layer and in-guest CRIU should not invalidate each
other. Users may have CRIU images or CRIU-capable tooling inside a VM. We need to
prove a supported Machinen snapshot/restore cycle preserves that guest-level
capability and supported guest storage.

## Objective

Prove that guest CRIU works before and after a Machinen snapshot/restore, and
that guest-created CRIU images stored on supported guest storage remain readable.

## Required proof

- [x] Boot a Machinen VM.
- [x] Run a guest CRIU checkpoint/restore proof before Machinen snapshot.
- [x] Store a guest-created CRIU image on supported guest storage.
- [x] Snapshot and restore the Machinen VM through the supported Machinen path.
- [x] Run the guest CRIU checkpoint/restore proof again after Machinen restore.
- [x] Verify the prior guest-created CRIU image remains readable after Machinen
      restore.
- [x] Record source architecture and target architecture.
- [x] Record whether the Machinen restore was same-arch VM state, cross-arch
      semantic restore, or another explicitly labeled supported path.

## Machine-readable output

Each summary row must include:

- `kind: machinen.cross-arch-criu.portable-snapshot-guest-criu-composition`
- `sourceArch`
- `targetArch`
- `machinenStateModel`
- `guestCriuVersion`
- `preSnapshotGuestCriuVerifier`
- `postRestoreGuestCriuVerifier`
- `storedCriuImageDigest`
- `storedCriuImageReadableAfterRestore`
- `migrationCompleted`
- refusal code/remediation when refused

## Non-goals

- Do not claim a source-ISA CRIU image can restore on a different ISA.
- Do not claim raw CRIU image replay is a cross-architecture restore mechanism.
- Do not count a guest CRIU demo as Machinen product support unless the outer
  Machinen restore path is also product-supported.

## Refusals

Refuse with stable wording when:

- guest storage containing the CRIU image is unsupported or dirty;
- guest CRIU capability is unavailable;
- Machinen restore would change ISA in a way that makes the stored CRIU image
  non-restorable but the test tries to restore it anyway;
- verifier output is missing or ambiguous.

## Tests and smokes

- [x] Composition smoke with pre/post guest CRIU proof.
- [x] Stored CRIU image readability proof.
- [x] Negative test preventing cross-ISA CRIU image restore claims.
- [x] Summary classification tests.

## Documentation

- [x] Explain the two layers: Machinen portable restore vs in-guest CRIU.
- [x] Explain what is preserved and what is only readable/proven.
- [x] Explain cross-ISA CRIU image limitations.

## Validation

Run and record timing for:

- [x] composition smoke;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
