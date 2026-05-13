# Machinen

Machinen runs guest workloads as arm64 microVMs whose entire state — memory,
file descriptors, TCP connections — can be snapshotted, restored, and forked
across hosts. This document fixes the language used to talk about it.

## Language

### Layers

**VMM** (a.k.a. _engine_):
The Zig-native arm64 microVM in `@machinen/microvm`; owns guest execution
(boot, virtio devices, HVF/KVM). Shipped as `@machinen/vmm-arm64-{darwin,linux}`.
_Avoid_: hypervisor (overloaded — HVF/KVM are hypervisors too).

**Runtime**:
The TypeScript control plane in `@machinen/runtime`; owns lifecycle, identity,
and host integration — provisioning, exec, snapshot/restore/fork, FUSE mounts,
networking shims, registry, GC. Supervises the VMM process.
_Avoid_: orchestrator, daemon, supervisor (each describes one role, not the whole).

**CLI**:
The `machinen` / `mn` binary in `@machinen/cli`; one front-end to the **Runtime**.
The Runtime is the canonical surface — the CLI is not the system.

**VM**:
The running pair of a **VMM** process and a **Runtime** supervision context.
When either is gone, there is no VM. Distinct from an _image_ (the rootfs
tarball that boots into a VM).

### Images

**Image**:
A `.tar.gz` rootfs that a **VM** boots from. The portable, deterministic
shipping unit — what `provision()` outputs and `boot({ image })` consumes.
_Avoid_: rootfs (file-system layer term; "image" is what we ship), tarball
(implementation detail).

**Base image**:
The **Image** a `provision()` run starts from. Any **Image** can be a Base
image — including the output of a previous `provision()` (layering is
supported). The runtime ships a Debian arm64 starter as the default when
no `base` is passed.

### Boot

**`/init`**:
The PID-1 process inside the guest, shipped in the initramfs and written
in Zig (`packages/microvm/assets/init.zig`). Machinen's own, not Debian's.
Mounts `/proc`, `/sys`, `/dev`; reads `/machinen-config.json` from the
**Image**; spawns the in-guest vsock agents; `execve`s the **Boot cmd**.
_Avoid_: "guest init" (overloaded — once the rootdisk is pivoted, the
workload is what acts as init from the kernel's perspective).

**Boot cmd**:
The argv `/init` exec's at the end of boot — the workload, from the
**VM**'s perspective. Baked into the **Image** via `provision({ cmd })`
at `/machinen-config.json#cmd`, or overridden per-boot via `boot({ cmd })`.
Distinct from anything the **Exec-agent** runs after boot (which uses
the **Exec channel**, not `execve`).
_Avoid_: bare "cmd" — `provision()`, `boot()`, `exec()`, and `fork()`
each take a `cmd` arg and they mean different things.

### Control plane

**vsock bridge**:
The VMM-provided forwarding layer that maps a guest vsock port to a host
Unix-domain socket. One entry per channel. Every host↔guest **control plane**
conversation rides this.

**Exec channel**:
The control wire between the **Runtime** and the in-guest `machinen-exec-agent`.
Machinen-defined opcode protocol (`EXEC` / `EXEC2 <len>\n<cmd>`, `X <code>\n`
terminator, framed stdout/stderr). Ours to redesign; versioned with the
exec-agent binary.

**Mount channel**:
The wire between the **Runtime**'s `mount-server` and the in-guest FUSE
byte-pump daemon, one per `--mount-live` mount. Speaks raw Linux FUSE kernel
ABI (`uapi/linux/fuse.h`, protocol 7.31) over vsock. Not ours to redesign —
the kernel owns this wire.

**Exec-agent**:
The Zig binary `/sbin/machinen-exec-agent` inside the guest. Listens on the
**Exec channel** and runs commands the **Runtime** sends.

### Networking

**gvproxy**:
The userspace TCP/IP sidecar (containers/gvisor-tap-vsock) the **Runtime**
spawns alongside each **VM**. The **VMM** dials its UDS to back the guest's
virtio-net NIC; gvproxy terminates the guest's TCP/IP stack. Provides both
outbound traffic and inbound **Port forwards**. One per VM. Optional —
without it, the VM boots with no network rather than failing.

**Port forward**:
A host-port → guest-port mapping (with optional `hostAddr`, default
`127.0.0.1`). Configured at boot/fork, registered with **gvproxy**, recorded
in the **Registry**. Host-local: not captured in a **Snapshot**, and a
**Fork** clears them by default to avoid colliding with the source.

### Host↔guest sharing

**Mount**:
A host directory shared into the **VM** at boot as a squashfs+ext4 overlay
(`--mount` flag, `boot({ mount })`). The host directory is captured at boot;
the guest reads from the squashfs lower and writes to the ext4 upper layer.
Writes stay **VM-local** — the host directory is not modified by the guest.
Captured in snapshot bundles and **travels** with the **VM** across hosts.

**Live mount**:
A host directory shared into the **VM** as a live FUSE window over the
**Mount channel** (`--mount-live` flag, `boot({ liveMounts })`). Reads and
writes flow to and from the host in real time over vsock — no copy.
`rw` (default) or `:ro`. Does **not** travel with snapshots — the runtime
unmounts before snapshot; restore on another host needs the live mount
re-established against a host directory there.

**`writeFile`**:
One-shot push of a single file from host code into the guest filesystem,
over the **Exec channel**. Programmatic only — no CLI flag. Used by
`provision()` install hooks for small files (config, scripts).

### Lifecycle

**Registry**:
On-disk record of currently running VMs at `~/.machinen/vms/`. PID-keyed; names
are uniqueness-enforced pin files that live and die with the VMM process.
The registry does not track stopped, exited, or crashed VMs — only live ones.

**Name**:
Optional human-friendly label on a running **VM**. Resolves to a PID at most
once. Not a persistent identity; a new boot with the same name is a different VM.

**Snapshot**:
A captured-on-disk freeze of a running **VM** — the workload's process tree
(CRIU dump) plus its file descriptors, written to a bundle directory. Capturing
a snapshot is **destructive by default** (the source VM ends). Pass
`leaveRunning: true` to capture without ending the source.

**Restore**:
Boot a fresh **VM** from a **Snapshot** bundle. The new VM resumes the captured
process tree exactly where it left off. Host arch must match the source's.

**Fork**:
Capture a non-destructive **Snapshot** of a running **VM** and **Restore** it as
a sibling. Both source and fork keep running on the same host. Fork applies
safety defaults the raw snapshot+restore pair does not (e.g. `tcpKeep: false`,
port forwards cleared) because the source and fork share global resources
that would otherwise collide.

## Relationships

- A **VM** is one **VMM** process supervised by one **Runtime** context
- The **CLI** is one of potentially many callers of the **Runtime**
- The **Runtime** speaks to the **VMM** but never embeds it
- A **VM** is in the **Registry** iff its VMM process is alive
- A **Snapshot** is not a VM — it's an artifact a VM can be **Restored** from
- A **Fork** produces a new VM; the source VM is unaffected
- An **Image** can be the **Base image** of a subsequent `provision()` (layering)
- A **VM** boots when `/init` reads the **Boot cmd** from its **Image** and `execve`s it; the **Exec-agent** is spawned alongside, on the **Exec channel**

## Migration contract

What a **Snapshot** carries across a **Restore** or **Fork**:

| Travels with the bundle                                                        | Stays on the source host                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Process tree (memory, FDs, registers, threads)                                 | Port forwards — caller re-supplies on restore/fork          |
| Open TCP connections (captured by CRIU)                                        | **Live mount** content (the host directory does not follow) |
| **Mount** overlay contents (squashfs lower + ext4 upper)                       | gvproxy NAT state                                           |
| **Live mount** _configuration_ (host UDS, guest path, mode) — content does not |                                                             |
| Source **Name** and source **Image** path (in `meta.json`)                     |                                                             |

Invariants:

- Host architectures must match (arm64↔arm64). CRIU replays machine-code
  register state; arm64↔x86 is not supported.
- A **Fork** defaults to `tcpKeep: false` (the fork sees ECONNRESET on captured
  TCP sockets) and clears port forwards, because both are global resources
  the source and fork would otherwise race over.
- **Restore** has two modes — _eager_ (default; tar-on-`/dev/vdb` + `criu
restore`) and _lazy_ (`criu restore --lazy-pages` over a vsock-FUSE-mounted
  bundle). Lazy does not compose with detached boot; eager stays default.
