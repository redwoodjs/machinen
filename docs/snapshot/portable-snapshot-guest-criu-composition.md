# Portable snapshot plus guest CRIU composition

This proof checks that two layers do not break each other:

1. **Machinen outer restore** — the supported VM snapshot/restore path.
2. **Guest CRIU** — Linux CRIU running inside that VM for same-guest,
   same-ISA process checkpoint/restore.

The proof does not use guest CRIU as a cross-architecture restore mechanism.

## Row shape

```json
{
  "kind": "machinen.cross-arch-criu.portable-snapshot-guest-criu-composition",
  "sourceArch": "arm64",
  "targetArch": "arm64",
  "machinenStateModel": "same-arch-vmstate",
  "guestCriuVersion": "Version: 4.2",
  "storedCriuImageReadableAfterRestore": true,
  "migrationCompleted": true
}
```

Rows also include the pre-snapshot guest CRIU verifier, post-restore guest CRIU
verifier, and a digest for the CRIU image directory that was created before the
outer Machinen snapshot.

## What the live smoke does

The smoke:

1. boots a Machinen VM;
2. writes a guest proof script into the VM;
3. compiles a small C counter in the guest;
4. runs `criu dump` and `criu restore` before the outer Machinen snapshot;
5. records a digest of the pre-snapshot guest CRIU image directory;
6. snapshots the whole VM with Machinen's `vmstate` engine;
7. restores that Machinen snapshot;
8. reads the old guest CRIU image directory again and verifies the digest;
9. runs a fresh guest CRIU dump/restore proof after the Machinen restore.

A real smoke example recorded:

```json
{
  "sourceArch": "arm64",
  "targetArch": "arm64",
  "machinenStateModel": "same-arch-vmstate",
  "preSnapshotGuestCriuVerifier": "pre=8 post=15 restoredPid=770 ...",
  "postRestoreGuestCriuVerifier": "pre=8 post=15 restoredPid=...",
  "storedCriuImageReadableAfterRestore": true
}
```

The stored CRIU image is treated as a readable guest artifact after Machinen
restore. This proof does not replay that old image across an ISA boundary.

## Refusal boundaries

Stable refusal codes include:

- `guest-criu-capability-unavailable` — guest CRIU checks did not pass.
- `guest-criu-storage-unsupported-or-dirty` — the stored image is not on supported
  clean guest-owned storage.
- `cross-isa-criu-image-restore-unsupported` — the test tried to claim CRIU image
  restore after an ISA-changing Machinen restore.
- `machinen-restore-path-unsupported` — the outer Machinen path is not a
  supported restore path.
- `composition-verifier-missing-or-ambiguous` — pre/post verifier output is not
  enough to prove composition.
- `stored-criu-image-unreadable-after-restore` — the old guest CRIU image digest
  could not be read after Machinen restore.

## What this proves

It proves that, on the checked host, a same-architecture Machinen `vmstate`
snapshot/restore preserves enough guest filesystem state for a prior guest CRIU
image directory to remain readable, and that guest CRIU can still dump/restore a
small C process after the outer restore.

## What this does not prove

It does not prove `amd64 <-> arm64` CRIU image replay. It does not prove a guest
CRIU image captured before an ISA-changing Machinen semantic restore can be
restored on the new ISA. It does not prove arbitrary CRIU workloads or JVM CRIU
support. It also does not promote guest CRIU demos into cross-arch Machinen
product support unless the outer Machinen restore path is product-supported.

## Running

```sh
pnpm run smoke-portable-snapshot-guest-criu-composition
```
