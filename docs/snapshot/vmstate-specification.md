# `.vmstate` specification

Status: current implementation, format version 1.

This document describes machinen's VMM-level snapshot format: what is
serialized, how it is bundled, and which parts are architecture-specific.
It intentionally separates two concepts that are easy to blur:

- **Cross-backend restore**: moving the same guest architecture between
  HVF and KVM. This is the portability target of `.vmstate`.
- **Cross-ISA restore**: moving a live `arm64` guest into an `amd64`
  guest, or the reverse. Whole-VM `.vmstate` snapshots are **same guest
  architecture only**. Guest RAM contains ISA-specific kernel code,
  userspace code, stacks, page tables, register ABI state, and device
  assumptions that cannot be reinterpreted as another ISA.

## Bundle layout

A vmstate snapshot bundle is a directory containing at least:

```text
<snapshot>/
  state.vmstate       # VMM-level VM state container
  meta.json           # restore invariants and sidecar identities
  rootdisk.img        # base checkpoint root block image, when present
```

Later incremental checkpoints may omit `rootdisk.img` and instead carry
RAM/rootdisk delta sections plus parent pointers in `meta.json`. Restore
materializes a flat temporary state/rootdisk pair before booting.

The `state.vmstate` file is normally plain bytes. If
`MACHINEN_VMSTATE_COMPRESSION=gzip` was set while writing, the whole
container is gzip-compressed. Readers sniff the gzip magic and accept
both forms.

## Snapshot/restore protocol

Snapshot:

1. The runtime boots the VMM with `MACHINEN_SNAPSHOT_PATH`.
2. `vm.snapshot()` sends `SIGUSR1` to the VMM.
3. The VMM stops the vCPU, captures vCPU/RAM/device state into immutable
   section payloads, then starts an atomic writer (`<path>.tmp` + rename).
4. The runtime waits for the final state file, copies it into the bundle,
   copies/reflinks sidecars, writes `meta.json`, then sends `SIGUSR2` so
   the source VM resumes.

Restore:

1. The runtime validates `meta.json`, materializes checkpoint chains if
   needed, and boots a fresh VMM with `MACHINEN_RESTORE_PATH`.
2. Before the first vCPU run, the VMM reads `state.vmstate`, validates the
   topology hash, and applies sections onto the freshly-created VM.
3. Backend-specific fixups are applied for timers/interrupt delivery.
4. The restored VM starts running from the captured vCPU state.

## Container format

All integers are little-endian.

### Header: 64 bytes

| Offset | Field           | Type     | Meaning                               |
| -----: | --------------- | -------- | ------------------------------------- |
|      0 | `magic`         | `u8[8]`  | `"VMSTATE\0"`                         |
|      8 | `version`       | `u32`    | currently `1`                         |
|     12 | `arch`          | `u32`    | `1 = aarch64`, `2 = x86_64`           |
|     16 | `section_count` | `u32`    | number of following sections          |
|     20 | `reserved`      | `u32`    | zero                                  |
|     24 | `topology_hash` | `u8[32]` | SHA-256 over the guest machine layout |
|     56 | `reserved2`     | `u8[8]`  | zero                                  |

### Section header: 16 bytes

Each section is:

| Field     | Type         | Meaning                      |
| --------- | ------------ | ---------------------------- |
| `tag`     | `u32`        | `SectionTag`                 |
| `id`      | `u32`        | subtype key; `0` when unused |
| `length`  | `u64`        | payload byte length          |
| `payload` | `u8[length]` | section-specific bytes       |

Unknown tags are ignored by current restore paths. New payloads should
use new tags; do not reuse existing tag numbers.

## Topology hash

The topology hash is a SHA-256 over these fields, in order:

1. guest architecture
2. RAM base
3. RAM size
4. GIC distributor base
5. GIC redistributor base
6. UART base
7. virtio-MMIO base
8. virtio-MMIO stride
9. virtio-MMIO count

Restore recomputes this for the fresh VM and refuses to apply state if it
mismatches.

## Section tags

| Tag | Name             | Used for                                                 |
| --: | ---------------- | -------------------------------------------------------- |
|   1 | `ram`            | full sparse guest RAM payload                            |
|   2 | `vcpu`           | architecture-specific vCPU state                         |
|   3 | `gic_dist`       | arm64 GICv3 distributor state                            |
|   4 | `gic_redist`     | arm64 GICv3 redistributor state                          |
|   5 | `virtio`         | virtio-MMIO transport state for one device               |
|   6 | `gic_cpuif`      | arm64 GIC CPU interface `ICC_*` state                    |
|   7 | `virtiofs_state` | host-side FUSE session state for one virtio-fs device    |
|   8 | `ram_delta`      | incremental RAM overlay against a parent checkpoint      |
|   9 | `rootdisk_delta` | incremental rootdisk overlay against a parent checkpoint |
|  10 | `x86_irqchip`    | x86 KVM PIC/IOAPIC state; `id` is KVM irqchip id         |
|  11 | `x86_pit`        | x86 KVM PIT state                                        |

## Payloads

### `ram`

Full RAM is sparse. Zero pages are implicit.

Payload layout:

```text
RamHeader (48 bytes)
  ram_base u64
  ram_size u64
  sha256[32]       # hash of the extent stream only

extent stream:
  offset u64       # byte offset into guest RAM
  length u64
  bytes[length]    # non-zero extent bytes
```

The encoder scans in 4 KiB pages and stores contiguous non-zero extents.
The loader starts from zeroed RAM and overlays extents.

### `ram_delta`

A RAM delta overlays a parent checkpoint's reconstructed RAM.

```text
RamDeltaHeader (64 bytes)
  ram_base u64
  ram_size u64
  page_size u32    # currently 4096
  reserved u32
  sha256[32]       # hash of extent stream
  reserved2[8]

extent stream:
  offset u64
  length u64
  bytes[length]    # dirty bytes; dirty zero pages are stored explicitly
```

### `vcpu`

The vCPU section uses a name-tagged entry list:

```text
entry_count u32
entry_count × {
  name_len u8
  name[name_len]       # ASCII register/bank name
  value_len u32
  value[value_len]
}
```

The names are the portability boundary. Backend-private register ids are
not serialized for arm64.

#### `aarch64` vCPU contents

The arm64 payload contains architectural names such as:

- GPRs: `X0`..`X30`
- control flow: `PC`, `PSTATE`
- stack/exception state: `SP_EL0`, `SP_EL1`, `ELR_EL1`, `SPSR_EL1`
- SIMD/FP: `V0`..`V31`, `FPSR`, `FPCR`
- system registers such as MMU, exception, timer, and kernel-control
  state (`SCTLR_EL1`, `TTBR0_EL1`, `TTBR1_EL1`, `TCR_EL1`, `VBAR_EL1`,
  timer registers, PAuth key registers, etc.)

Registers are classified before dump:

- **portable**: copied and expected to represent guest state
- **mask**: copied but known to legitimately diverge, such as PMU/debug
  counters or timer state
- **translate**: host-relative timer offset state
- **skip**: host-determined identity/discovery/cache-topology/RNG state

Important skipped examples: `MIDR_EL1`, `MPIDR_EL1`, `ID_AA64*`, cache
identity registers, and host RNG registers.

#### `x86_64` vCPU contents

The x86_64 payload stores KVM's x86 state banks under named entries:

- `X86_SREGS`: segments, descriptor tables, control regs, `EFER`, APIC base
- `X86_REGS`: GPRs, `RIP`, `RFLAGS`
- `X86_FPU`: x87/XMM state
- `X86_LAPIC`: local APIC state
- `X86_MP_STATE`: vCPU multiprocessing state
- `X86_VCPU_EVENTS`: pending exception/interrupt event state
- `X86_MSRS`: selected MSRs (`TSC`, SYSENTER, PAT, syscall MSRs,
  FS/GS bases, kernel GS base, `TSC_AUX` when available)
- optional `X86_DEBUGREGS`, `X86_XCRS`, `X86_XSAVE`

These are x86_64-specific and are not translatable to arm64 vCPU state.

### `gic_dist`, `gic_redist`, `gic_cpuif`

arm64 interrupt state is split into:

- GICv3 distributor MMIO registers
- per-vCPU redistributor SGI/PPI registers
- per-vCPU CPU interface `ICC_*` registers

Distributor/redistributor payloads are lists of:

```text
count u32
count × {
  offset u32       # GICv3 register offset
  width u32        # 4 or 8; current tables emit 4-byte regs
  value u64
}
```

The CPU interface payload reuses the vCPU name-tagged format for
registers like `ICC_SRE_EL1`, `ICC_PMR_EL1`, and `ICC_IGRPEN1_EL1`.

Without this state, Linux may believe timer and virtio interrupts are
enabled while the fresh interrupt controller drops them, leaving the
restored guest stuck.

### `x86_irqchip`, `x86_pit`

x86_64 uses KVM's in-kernel legacy platform state instead of a GIC:

- `x86_irqchip`: raw `struct kvm_irqchip`; `id` is:
  - `0`: master PIC
  - `1`: slave PIC
  - `2`: IOAPIC
- `x86_pit`: raw `struct kvm_pit_state2`

These sections are x86/KVM platform state and have no arm64 equivalent.

### `virtio`

One section is written per present virtio-MMIO device. The section `id`
is the device's MMIO base so restore can match it to the fresh device.

The payload captures VMM-side transport state, not the in-RAM virtqueue
rings themselves:

```text
Header (32 bytes)
  device u32             # virtio device id
  queue_count u32
  driver_features u64
  status u32
  queue_sel u32
  interrupt_status u32
  reserved u32

queue_count × QueueState (40 bytes)
  num u32
  ready u32
  last_avail_idx u32
  pad u32
  desc_addr u64
  driver_addr u64
  device_addr u64
```

The guest-owned ring descriptors and buffers are restored by the RAM
section. This section restores the device-side queue pointers, negotiated
features, status, and consumed-ring cursor.

### `virtiofs_state`

A virtio-fs device has two pieces of state:

1. virtio transport state (`virtio` section)
2. host-side FUSE session state (`virtiofs_state` section)

The FUSE state payload contains:

- mount mode (`rw`/`ro`)
- next node id and next handle id
- `nodeid -> relative path` map with lookup counts
- open file/dir handle table
- packed directory-entry buffers for open directory handles

It deliberately does **not** capture:

- the host mount root path (`root_abs`), supplied fresh at boot
- host file descriptors, reopened by path on restore
- profiling/statistics fields

If a file handle cannot be reopened because the host file changed or was
removed, restore keeps the handle as `fd = -1`; later guest operations
fail soft with `EBADF` instead of wedging the VMM.

### `rootdisk_delta`

Rootdisk deltas are dirty 4 KiB block overlays against a parent
checkpoint's rootdisk image.

```text
Header (56 bytes)
  disk_size u64
  block_size u32       # currently 4096
  reserved u32
  sha256[32]
  reserved2[8]

extent stream:
  offset u64
  length u64
  bytes[length]
```

A base checkpoint normally carries `rootdisk.img` outside the `.vmstate`
container. Later checkpoints can carry `rootdisk_delta` sections and
record `rootDisk: "delta"` in `meta.json`.

## `meta.json` restore invariants

`meta.json` is not part of the binary `.vmstate` container, but restore
requires it for safety. New bundles record:

- source backend: `hvf`, `kvm`, or `unknown`
- guest architecture: `arm64`, `amd64`, or `unknown`
- topology hash copied from the `.vmstate` header
- guest RAM ceiling/layout in MiB
- arm64 PAuth status inferred from `SCTLR_EL1`
- rootdisk mode and identity/hash
- restore shell identity: rootfs, kernel, optional DTB, and a stable
  path-independent shell id
- kernel and DTB identity/hash when explicit files were used (legacy
  compatibility fields)
- checkpoint chain id, sequence, parent pointer, and delta/full markers

Restore refuses bundles that predate these invariants.

## Architecture and backend portability policy

### Same-architecture only

The `.vmstate` header and `meta.json` both record guest architecture.
Restore refuses an `arm64` snapshot into an `amd64` guest or the reverse.

This is by design. Whole-VM snapshots include raw guest RAM and raw vCPU
state. Those bytes encode the guest ISA's page tables, exception model,
thread state, code, stack frames, syscall ABI, TLS layout, and kernel
assumptions.

### Cross-HVF/KVM arm64

arm64 HVF/KVM portability is achieved by serializing architectural names
and GIC register offsets instead of HVF/KVM private handles. Restore then
maps those names/offsets back onto the destination backend.

Cross-HVF/KVM restore is refused when guest pointer authentication is
active or unknown. PAuth keys and signed pointers can make RAM meaningful
only under a compatible PAuth execution environment. The default machinen
DTB disables guest PAuth with `arm64.nopauth` for portable snapshots.

Timer state is host-relative. Restore applies backend-specific timer
fixups so the guest resumes near the captured virtual timer point instead
of seeing a large host-counter discontinuity.

### x86_64

The current x86_64 path is KVM-based and stores KVM x86 state banks plus
KVM PIC/IOAPIC/PIT state. These sections are not meaningful to arm64 and
are not a cross-ISA bridge.

## State intentionally outside `.vmstate`

The binary container does not capture every host resource:

- port-forward configuration and host networking sidecars are recreated
  by the runtime; established host-side TCP streams are not portable
- live-mount host root paths are supplied at restore and FUSE fds are
  reopened by path
- rootdisk base bytes live as `rootdisk.img` sidecars or are materialized
  from checkpoint chains
- entropy is present in RAM, so restore injects fresh entropy into the
  guest after boot
- provider-level snapshots of nested-enabled VMs are refused until nested
  KVM/HVF state is explicitly captured

## Versioning rules

- Keep existing header fields and section tag numbers stable.
- Add new header fields only by using reserved space or bumping the
  format version.
- Add new section kinds with new tag numbers.
- Payloads should be little-endian and self-bounded.
- Restore paths should ignore unknown sections unless the new state is
  required for correctness, in which case `meta.json` should advertise a
  restore invariant and old restore paths should refuse the bundle.
