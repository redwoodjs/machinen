# microvm rootfs contract

What the VMM expects from the host (env vars) and what `/init`
expects from the rootfs (layout + config schema). If you're packing a
bundle by hand or porting `@machinen/runtime`, this is the surface
you have to honor.

## Host → VMM (env vars)

The VMM reads paths and feature flags from `MACHINEN_*` env vars
(`src/main.zig`, `src/boot_hvf.zig`, `src/boot_kvm.zig`):

| Var                   | Required | Purpose                                                                                                                                                      |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MACHINEN_KERNEL`     | yes      | Path to the arm64 `Image` (uncompressed). Loaded into guest RAM.                                                                                             |
| `MACHINEN_DTB`        | yes      | Path to the device tree blob. Address handed to the kernel in `X0`.                                                                                          |
| `MACHINEN_INITRD`     | yes      | Path to the cpio initramfs. Holds `/init` plus per-boot ephemera.                                                                                            |
| `MACHINEN_ROOTDISK`   | no       | Path to an ext4 image exposed as `/dev/vda`. `/init` pivots into it (see below).                                                                             |
| `MACHINEN_DISK`       | no       | Path to a scratch disk. Exposed as `/dev/vda` when `MACHINEN_ROOTDISK` is unset, otherwise as `/dev/vdb`.                                                    |
| `MACHINEN_VSOCK`      | no       | Comma-separated `in:<port>:<uds>` / `out:<port>:<uds>` entries. Bridges guest vsock ports to host Unix-domain sockets.                                       |
| `MACHINEN_NET_SOCKET` | no       | Path to a [gvproxy](https://github.com/containers/gvisor-tap-vsock) qemu-netdev UDS. When set, the VMM dials it for virtio-net; otherwise networking is off. |

Direct invocation without these vars exits with a usage error
pointing at `machinen boot`.

## Boot register ABI

The kernel jump uses the Linux arm64 boot protocol:

- `X0` = guest-physical address of the DTB
- `X1`–`X3` = 0
- `PC` = kernel entry (start of the loaded `Image`)

`src/boot_hvf.zig` and `src/boot_kvm.zig` set these identically; the
backends only differ in how they program the vCPU registers.

## Shutdown

`/init` (and any in-guest userspace that wants to terminate the VM)
issues PSCI `SYSTEM_OFF` — function ID `0x84000008` via `HVC #0`. The
VMM's exit loop matches on this and returns `exit(0)`. Anything else
(fatal exception, exhausted exit budget) returns non-zero.

## Bundle layout

A bundle is the cpio that `MACHINEN_INITRD` points at, optionally
paired with a rootdisk image that `MACHINEN_ROOTDISK` points at. At
boot, `/init` looks for the following paths:

### Always (cpio root)

- `/init` — PID 1. Mounts `/proc`, `/sys`, `/dev`; opens the console;
  loads the config; optionally pivots; execs the user `cmd`.
- `/machinen-config.json` — workload spec. Schema below.

### Optional (cpio root)

- `/etc/machinen-boot-epoch` — ASCII decimal Unix epoch seconds. When
  present, `/init` seeds `CLOCK_REALTIME` from it so TLS and `apt`
  date checks work before NTP. Written by `mkinitramfs.ts` from the
  host's wall clock.
- `/mnt/<guest>/...` — overlay payload for `mount: { host, guest }`.
  Carried across the rootdisk pivot via a best-effort recursive copy.

### Inside the rootdisk (when `MACHINEN_ROOTDISK` is set)

- ext4 filesystem on the whole image (no partition table). `/init`
  mounts `/dev/vda` directly and `EXT4_IOC_RESIZE_FS`-grows the fs to
  fill the device.
- `/sbin/machinen-supervisor` — pivot marker. Its presence is what
  tells `/init` "this is a real machinen rootfs, not a CRIU scratch
  disk." Without it, `/init` unmounts and falls through to the
  initramfs-as-rootfs path.
- `/sbin/machinen-netup` — optional. Forked after pivot to bring up
  `eth0` (`192.168.127.2/24`, gateway+DNS `192.168.127.1`) when
  gvproxy is wired up. Missing or non-zero exit logs a warning and
  the user `cmd` runs without networking.

## `/machinen-config.json` schema

Parsed by `loadConfig` in `assets/init.zig`. JSON object with the
following keys:

| Key          | Type                               | Required | Notes                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmd`        | `string[]`                         | yes      | Argv for `execve`. Must be non-empty; `cmd[0]` is also the path.                                                                                                                                                                                                             |
| `env`        | `{ [k: string]: string }`          | no       | Each entry becomes a `KEY=VALUE` envp slot. If `TERM` isn't set, `/init` injects `TERM=linux`.                                                                                                                                                                               |
| `cwd`        | `string`                           | no       | `chdir`'d before `execve`.                                                                                                                                                                                                                                                   |
| `liveMounts` | `[{ guest: string, tag: string }]` | no       | One live mount per entry, served by an in-VMM virtio-fs device (#332). `tag` matches the device's config-space tag. `/init` runs `mount -t virtiofs <tag> <guest>` and waits up to 5s for the mount to appear in `/proc/self/mounts` before exec'ing `cmd`. Up to 5 entries. |

Validation errors abort the boot via PSCI `SYSTEM_OFF` after logging
to `/dev/kmsg` and the console. Unknown keys are ignored.

## Where the contract is enforced

The code is the source of truth. Starting points:

- `../src/main.zig` — env-var parsing
- `../src/boot_hvf.zig` / `../src/boot_kvm.zig` — kernel/DTB load,
  vCPU register ABI, virtio device wiring
- `../assets/init.zig` — bundle layout, config schema, rootdisk pivot
- `../../runtime/src/vm.ts` — how `@machinen/runtime` populates the
  env vars and packs the cpio
