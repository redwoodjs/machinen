# Portable snapshot plus guest checkpoint composition

This proof checks that two layers do not break each other:

1. **Machinen outer restore** — the supported VM snapshot/restore path.
2. **Guest checkpoint** — a Linux checkpoint tool running inside that VM for
   same-guest, same-ISA process checkpoint/restore. The current fixture uses the
   `criu` command as that tool.

The proof does not use guest checkpoint as a cross-architecture restore mechanism.

## Row shape

```json
{
  "kind": "machinen.architecture-portable-snapshot.portable-snapshot-guest-checkpoint-composition",
  "sourceArch": "arm64",
  "targetArch": "arm64",
  "machinenStateModel": "same-arch-vmstate",
  "guestCheckpointVersion": "Version: 4.2",
  "storedCheckpointImageReadableAfterRestore": true,
  "migrationCompleted": true
}
```

Rows also include the pre-snapshot guest checkpoint verifier, post-restore guest
checkpoint verifier, and a digest for the checkpoint image directory that was
created before the outer Machinen snapshot.

## What the live smoke does

The smoke:

1. boots a Machinen VM;
2. writes a guest proof script into the VM;
3. compiles a small C counter in the guest;
4. runs the guest checkpoint tool before the outer Machinen snapshot;
5. records a digest of the pre-snapshot guest checkpoint image directory;
6. snapshots the whole VM with Machinen's `vmstate` engine;
7. restores that Machinen snapshot;
8. reads the old guest checkpoint image directory again and verifies the digest;
9. runs a fresh guest checkpoint dump/restore proof after the Machinen restore.

A real smoke example recorded:

```json
{
  "sourceArch": "arm64",
  "targetArch": "arm64",
  "machinenStateModel": "same-arch-vmstate",
  "preSnapshotGuestCheckpointVerifier": "pre=8 post=15 restoredPid=770 ...",
  "postRestoreGuestCheckpointVerifier": "pre=8 post=15 restoredPid=...",
  "storedCheckpointImageReadableAfterRestore": true
}
```

The stored checkpoint image is treated as a readable guest artifact after Machinen
restore. This proof does not replay that old image across an ISA boundary.

## Refusal boundaries

Stable refusal codes include:

- `guest-checkpoint-capability-unavailable` — guest checkpoint checks did not pass.
- `guest-checkpoint-storage-unsupported-or-dirty` — the stored image is not on
  supported clean guest-owned storage.
- `cross-isa-checkpoint-image-restore-unsupported` — the test tried to claim
  checkpoint image restore after an ISA-changing Machinen restore.
- `machinen-restore-path-unsupported` — the outer Machinen path is not a
  supported restore path.
- `composition-verifier-missing-or-ambiguous` — pre/post verifier output is not
  enough to prove composition.
- `stored-checkpoint-image-unreadable-after-restore` — the old guest checkpoint
  image digest could not be read after Machinen restore.

## What this proves

It proves that, on the checked host, a same-architecture Machinen `vmstate`
snapshot/restore preserves enough guest filesystem state for a prior guest
checkpoint image directory to remain readable, and that guest checkpointing can
still dump/restore a small C process after the outer restore.

## What this does not prove

It does not prove `amd64 <-> arm64` checkpoint image replay. It does not prove a
guest checkpoint image captured before an ISA-changing Machinen semantic restore
can be restored on the new ISA. It does not prove arbitrary checkpoint workloads
or JVM checkpoint support. It also does not promote guest checkpoint demos into cross-arch Machinen
product support unless the outer Machinen restore path is product-supported.

## Running

```sh
pnpm run smoke-portable-snapshot-guest-checkpoint-composition
```
