# Whole Linux VM workload portability taxonomy

Status: definition-only. This document defines the future claim boundary; it does
not raise any product claim.

Current claim remains:

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Meaning

**Whole Linux VM workload support** means target-native reconstruction of a
_declared Linux VM workload context_ from retained portable artifacts and
verifiers.

It does **not** mean:

- raw vCPU/register replay across architectures;
- arbitrary VM restore;
- arbitrary guest kernel/device state migration;
- arbitrary Linux process memory/register continuation;
- source ISA emulation;
- metadata-only VM success;
- app checkpoint hooks as the source of truth;
- sidecar replay.

## First supported subset candidate

`selected-whole-vm-workload-v1`

A tiny declared VM workload whose rootfs/app files, workload command, input data,
expected outputs, and target verifier are represented by portable retained
artifacts.

Required supported rows:

1. **Target-native VM boot** — target VM boots target-native Linux without source
   kernel or CPU replay.
2. **Portable rootfs/app files** — rootfs/app/data files reconstruct from a
   portable manifest with hashes.
3. **Declared workload command** — workload restarts/reconstructs from declared
   workload state, not raw process memory.
4. **Source/target verifier match** — target verifier proves equivalent workload
   behavior.
5. **Bidirectional retained artifacts** — both `arm64 -> amd64` and
   `amd64 -> arm64` retain capture, restore, transcript, manifest, and verifier
   artifacts.

## Refusal boundaries

Each future support matrix must retain product refusal artifacts for these
neighboring states:

| Boundary                                | Disposition                 | Reason                                                           |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| raw vCPU state across ISA               | forbidden                   | source register state cannot be replayed on a different ISA      |
| guest kernel/device state               | refused                     | opaque kernel/device state is not a portable workload artifact   |
| arbitrary process memory continuation   | refused                     | arbitrary Linux process restore remains a separate `0` claim     |
| active network connection migration     | refused                     | requires protocol-aware reconstruction or reconnect policy       |
| unmodeled live mount/FUSE state         | refused                     | must be represented by explicit portable mount artifacts         |
| dirty block device without manifest     | refused                     | cannot be treated as restored without portable block/data proof  |
| architecture-specific kernel/module ABI | refused                     | source-architecture modules/dependencies are not target-portable |
| privileged kernel features              | refused or capability-gated | eBPF/seccomp/KVM need retained probes and explicit boundaries    |

## Artifact requirements

Supported direction artifacts:

- source workload manifest;
- source verifier output;
- portable rootfs/app/data manifest with hashes;
- capture transcript;
- restore plan;
- target verifier output;
- target boot/workload transcript;
- shortcut inspection record;
- artifact integrity manifest.

Refusal direction artifacts:

- refusal input manifest;
- product command transcript;
- stable expected refusal code;
- evidence for the boundary condition;
- shortcut inspection record when relevant.

## Dashboard claim language

Until retained support/refusal artifacts exist:

> Whole Linux VM workload portability is definition-only. Current claim remains
> `0 / 0 / 0`.

If the first subset is proven later:

> Selected whole-VM workload restore: `100 / 100 / 0` for
> `selected-whole-vm-workload-v1` only.

Required boundary text:

> Not arbitrary VM restore, not raw cross-ISA VM-state replay, and not arbitrary
> Linux process restore.

Machine-readable copy:

- `docs/snapshot/whole-linux-vm-workload-taxonomy.json`
