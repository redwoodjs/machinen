import type { OnLog } from "../log.ts";

export interface BootOptions {
  /**
   * Path to a rootfs tarball to boot from (e.g. the output of
   * `provision()`, or an arch-specific base rootfs tarball shipped in
   * releases: `rootfs-debian-arm64.tar.gz` / `rootfs-debian-amd64.tar.gz`).
   * Paired with `cmd` — both required, or neither (test-mode binary
   * boots and snapshot-only restores both skip initramfs packing).
   */
  image?: string;
  /**
   * Command to run inside the guest. Packed into the synthesized
   * `/machinen-config.json`. Paired with `image` — both required, or
   * neither.
   */
  cmd?: string[];
  /**
   * Env vars exposed to the guest workload. Packed into the synthesized
   * `/machinen-config.json`. Distinct from `vmmEnv`, which only affects
   * the host-side VMM process.
   */
  env?: Record<string, string>;
  /**
   * Working directory for the guest cmd. Lands as `cwd` in the
   * synthesized `/machinen-config.json`; `/init` calls `chdir()` to
   * this path before exec'ing the cmd. Useful with `mount` /
   * `liveMounts` to land directly inside the share (e.g.
   * `guestCwd: "/mnt/workspace"`).
   *
   * Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
   * paths containing NULs. Same precedence as `cmd`/`env`: an
   * image-baked `cwd` is overridden by this field when both are set.
   */
  guestCwd?: string;
  /**
   * Attach a scratch virtio-blk device (`/dev/vdb`, or `/dev/vda` on
   * pre-#114 layouts) so this VM can be CRIU-snapshotted later via
   * `vm.snapshot()`. Three forms:
   *
   *   - `undefined` (default) — the runtime auto-allocates a per-boot
   *     ~8 GiB sparse scratch in `tmpdir()` and unlinks it on VM exit.
   *     Disk usage stays at zero until the guest writes; the upside is
   *     every booted VM is snapshotable without re-booting. See #50.
   *
   *   - `'<path>'` — caller-managed file. Used as-is (must exist).
   *     Used by `restore()` to attach a tar archive of the bundle's
   *     checkpoint images on `/dev/vdb`; the guest's
   *     `/sbin/machinen-restore` untars it and runs `criu restore`.
   *     The runtime synthesizes `cmd: ['/sbin/machinen-restore']` if
   *     no other cmd is given.
   *
   *   - `false` — opt out entirely. No `/dev/vdb` attached. Use when
   *     you don't need snapshot capability and want to skip the
   *     (sparse, but still nonzero) inode allocation — typical for
   *     fast-cycling test boots.
   */
  snapshot?: string | false;
  /**
   * Boot the guest with the rootfs on a virtio-blk device (`/dev/vda`)
   * instead of inflating the whole rootfs into a RAM-backed tmpfs via
   * the initramfs. See #114.
   *
   * Default: `true` whenever `image` is set. The runtime materializes
   * an ext4 image from `image` (cached at
   * `~/.cache/machinen/rootfs/<sha256>.img`) and attaches it as the
   * rootdisk; the guest's `/init` mounts + chroots into it before
   * running the user cmd. Materialization needs `mke2fs` (or
   * `mkfs.ext4`) on PATH — `brew install e2fsprogs` on macOS, the
   * `e2fsprogs` package on Linux.
   *
   *   - `string` — path to a pre-built ext4 `.img` file to attach
   *                directly. Skips the materialize step + cache.
   *   - `false`  — opt out: keep the cpio-as-rootfs path. The whole
   *                rootfs lands in a tmpfs at boot (RAM scales ~8×
   *                with rootfs size). Mostly an escape hatch for
   *                tooling that doesn't need disk-backed semantics
   *                (e.g. `provision()` itself).
   */
  rootDisk?: boolean | string;
  /**
   * Absolute target size (bytes) for the materialized rootdisk image.
   * Defaults to `max(2 GiB, treeBytes * 2.5)` — generous enough that
   * boot-time `npm install -g <large package>` / `apt install ...`
   * land without ENOSPC. Bump this for workloads that write more
   * (e.g. 8 GiB for a build tree, 16 GiB for a model cache).
   *
   * The host file is sparse — unused capacity costs nothing on disk
   * until the guest writes. The guest's online ext4 grow (in /init)
   * resizes the on-disk filesystem to fill the file on every boot,
   * so bumping this against an existing cached image works without
   * a rematerialize.
   *
   * Ignored when `rootDisk` is a string path (the caller-provided
   * image is taken as-is) or `rootDisk: false`. See #131.
   */
  rootDiskSizeBytes?: number;
  /**
   * Optional name to register this VM under (`attach({ name })`
   * lookup key). Path-shaped strings ("worker/9012") are allowed.
   * Names are unique while live — `boot()` throws
   * `REGISTRY_NAME_IN_USE` if another VM already holds the name.
   */
  name?: string;
  /**
   * Bookkeeping: absolute path to the snapshot bundle this VM was
   * forked from. Set by `restore({ snapDir })`; visible in
   * `machinen ls`. Plain `boot()` leaves it undefined.
   */
  forkedFrom?: string;
  /**
   * A single host directory exposed to the guest as a writable
   * filesystem rooted under `/mnt/<guest>/`. Guest writes survive
   * snapshot/restore but never leak to the host source dir.
   *
   * Implementation (#272): the runtime builds a content-addressed
   * read-only squashfs lower from `host` (cached in
   * `~/.cache/machinen/mountdisk/`) and a per-VM ext4 sparse upper
   * (4 GiB by default; bump via `mountDiskUpperSizeBytes`). Both
   * files are fd-passed to the VMM, surfacing inside the guest as
   * `/dev/vdc` (RO) and `/dev/vdd` (RW); /init layers them as a
   * single overlayfs at `<guest>/`. The squashfs lower stays
   * sealed for the VM's lifetime; writes go to the upper, which
   * is reflinked into snapshot bundles so forks see prior writes
   * without touching the source dir.
   *
   * Trade-off vs. `liveMount`: `mount` is copy-into-disk-image (no
   * runtime channel back to the host source dir, snapshots cleanly,
   * but writes don't propagate to the host); `liveMount` is an in-VMM
   * virtio-fs pass-through (writes land on the host and restore/fork
   * re-establish the same guest mount topology). Pick `mount` for inputs the
   * guest may modify but the host shouldn't see; `liveMount` for shared scratch.
   *
   * See #64 (original `mount`), #78 (`liveMount`), #114 (rootdisk
   * relocation; same shape), #272 (this overlay relocation).
   */
  mount?: { host: string; guest: string };
  /**
   * Absolute target size (bytes) for the per-VM ext4 RW upper of
   * the `--mount` overlay (#272). Sparse, so unused capacity costs
   * nothing on the host disk. Mirrors `rootDiskSizeBytes` (#131) —
   * over-provision so the guest has plenty of room to write into
   * the mount before hitting ENOSPC.
   *
   * Must be a positive multiple of 4096. Default 4 GiB.
   */
  mountDiskUpperSizeBytes?: number;
  /**
   * Internal: when set, skips the squashfs+ext4 materialization
   * pipeline and uses pre-existing lower/upper files (typically the
   * ones a snapshot bundle carries). Used by `restore()` to
   * reconstruct the overlay without re-running `mksquashfs` on the
   * host source dir (which may not exist on the restoring host).
   *
   * The runtime reflinks `upperPath` into a per-VM path so guest
   * writes don't mutate the bundle in-place.
   *
   * @internal
   */
  _restoreMountDisk?: {
    guest: string;
    lowerPath: string;
    upperPath: string;
  };
  /**
   * Vmstate engine restore: absolute path to the bundle's
   * `state.vmstate`. Set by `restore()` when it detects a vmstate
   * bundle. `boot()` forwards it to the VMM as `MACHINEN_RESTORE_PATH`
   * — the VMM loads that whole-VM state before the first vCPU run, so
   * the guest resumes mid-execution instead of cold-booting.
   *
   * @internal
   */
  _vmstateRestorePath?: string;
  /**
   * Vmstate restore: exact root block image from the snapshot bundle.
   * `boot()` reflink-clones this into a per-VM temp file before
   * attaching it so the restored guest cannot mutate the bundle.
   *
   * @internal
   */
  _rootDiskRestorePath?: string;
  /**
   * Host directories exposed to the guest as live-share mounts (#78,
   * #332). Unlike `mount` (copy-once into the boot rootfs), these stay
   * connected to the host: the guest reads on demand and nothing is
   * copied at boot. `mode` defaults to `"rw"` — guest writes land on
   * the host (#151, #156). Set `"ro"` for a one-way share (host
   * caches, untrusted guests).
   *
   * Each guest path must live under `/mnt/` (same rule as `mount`).
   * Repeatable up to 5 entries per VM — each is served by its own
   * in-VMM virtio-fs device (the VMM wires 5 virtio-fs slots). The
   * FUSE opcode handlers run inside the VMM and the guest mounts each
   * share directly with `mount -t virtiofs` — no agent process, no
   * vsock hop. Requires a guest kernel with `CONFIG_VIRTIO_FS` — every
   * machinen-built kernel has it. (The older FUSE-over-vsock transport
   * and its `protocol` knob were removed in #338.)
   *
   * Snapshot / restore / fork (#273): liveMount has no guest-side
   * state worth checkpointing — reads come from the host on demand,
   * writes (in `"rw"`) land on the host immediately. The in-VMM
   * virtio-fs device persists across the CRIU dump, so the workload's
   * view of `/mnt/<guest>/` survives `vm.snapshot({ leaveRunning:
   * true })` and `vm.fork()` without an unmount/remount window.
   *
   * Concurrent writes from multiple forks against the same host
   * directory are no different from any other shared filesystem —
   * each VM gets its own device but the runtime doesn't coordinate
   * writes between siblings. If two forks need non-overlapping write
   * surfaces, point each at a distinct `host` path or use `mount`
   * (copy-once, per-VM upper).
   *
   * Restore on a host where the recorded `host` path doesn't exist:
   * fails loudly via `BOOT_MOUNT_HOST_NOT_FOUND`. Pass
   * `restore({ liveMounts: [...] })` to override per-`guest` —
   * each override entry's `guest` must match a recorded entry.
   *
   * Security note: a live-share mount gives a compromised guest a
   * persistent channel back to the host filesystem. Containment keeps
   * that bounded to the configured host root. `mount` (copy-once) has
   * no such runtime channel and is strictly safer — prefer it for
   * inputs you don't need write-through on.
   */
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode?: "ro" | "rw";
  }>;
  /**
   * Host -> guest TCP port forwards installed via gvproxy's control
   * API. Each entry maps `hostPort` on the host (bound to `hostAddr`,
   * default `127.0.0.1`) to `guestPort` inside the guest.
   */
  portForward?: Array<{ hostPort: number; guestPort: number; hostAddr?: string }>;

  // --- host/VMM-process config ---

  /**
   * Absolute or cwd-relative path to the VMM binary. Optional —
   * if omitted, `boot()` resolves it via `resolveVmmBinary()`.
   */
  binary?: string;
  /** Working directory for the VMM (for finding fixture files). */
  cwd?: string;
  /** Extra argv for the VMM. */
  args?: string[];
  /** Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`. */
  kernel?: string;
  /** Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`. */
  dtb?: string;
  /**
   * Opt in to exposing arm64 EL2 / `/dev/kvm` to the guest so the
   * workload can start its own VMs. This is intentionally off by
   * default: it requires Linux/arm64 KVM with nested EL2 support, or
   * macOS 15+ on M3/M4-class Apple Silicon, and provider-level
   * snapshots of a nested-enabled VM are refused until EL2 vmstate
   * capture is audited.
   *
   * When set, the runtime does a best-effort host preflight and passes
   * `MACHINEN_NESTED=1` to the VMM. The VMM's backend probe is still
   * authoritative.
   */
  nested?: boolean;
  /**
   * Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
   * VMM reads this as `MACHINEN_MEMORY` (#263 phase A). This is the
   * guest's memory layout limit, not the host memory used right now.
   * Defaults to `min(host_ram_mib / 2, 4096)` with a floor of 512 — a
   * modest ceiling for typical dev workloads. The ceiling is
   * approximately free until the guest touches a page (see
   * `packages/microvm/docs/memory.md`), but a bigger ceiling still
   * increases guest metadata and the possible high-water mark.
   *
   * This is documented as a debug knob — most workloads should never
   * need to set it.
   */
  memory?: number;
  /**
   * Wrap the VMM through the parent-death shim so it dies with this
   * runtime process. Default true — the right answer for the common
   * "boot, do work, exit" CLI flow.
   *
   * Set to false when the VMM is supposed to outlive the spawning
   * process. `vm.fork()` (#216) sets this so the forked sibling
   * survives `cli fork` returning. Without it, the kqueue-watching
   * shim catches the CLI exit and SIGTERMs the fork mid-startup.
   */
  pdeathsig?: boolean;
  /**
   * Milliseconds to wait in `wait()` before giving up and rejecting.
   * Defaults to 60s. Pass `null` to wait forever.
   */
  timeoutMs?: number | null;
  /**
   * Env passed to the VMM process on the host side (not exposed to the
   * guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.
   */
  vmmEnv?: Record<string, string>;
  /**
   * Streaming log callback — fires for every byte of guest output:
   * kernel console (VMM stderr) and every exec invocation made through
   * the returned handle. See `LogEvent.source` to tell them apart. See
   * #83. For per-call output-only tees on a single exec, use
   * `vm.exec({ onStdout, onStderr })` instead.
   */
  onLog?: OnLog;
  /**
   * Detach the VMM from the runtime parent so the parent can exit
   * while the VM keeps running (issue #150 phase 2). When set, `boot()`
   * blocks only until the guest produces its first console byte
   * (readiness signal) and then resolves a handle whose `.wait()` /
   * `.output()` no longer reflect the live VM — the parent has unrefed
   * the child and is free to exit.
   *
   * Forces `pdeathsig: false` (otherwise the parent's exit kills the
   * VMM, defeating the purpose). Compatible with every other boot
   * option: gvproxy is tracked in the registry, live mounts are served
   * by in-VMM virtio-fs devices, and `mount` (squashfs+ext4 overlay)
   * is fd-passed to the VMM at spawn so the supervisor holds no live
   * state afterwards.
   *
   * Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
   * directories normally happens in the parent's `child.once("exit")`
   * hook. After detach the parent is gone, so those leak until
   * `machinen gc` / `machinen stop` reaps them.
   *
   * Reattach with `attach({ name | pid })` from another process —
   * the registry entry stays live, the vsock UDS is still listening.
   */
  detached?: boolean;
}
