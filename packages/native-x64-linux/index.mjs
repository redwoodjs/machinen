import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Consolidated host-tool binary package. Replaces the per-tool
// packages (vmm / e2fsprogs / squashfs-tools) — one install, one
// optionalDependency, one os/cpu gate per host.
//
// Layout is per-tool subdirs so dyld's `@loader_path/../lib` keeps
// resolving for the bundled e2fsprogs/squashfs dylibs: mke2fs lives at
// e2fsprogs/bin/mke2fs and loads e2fsprogs/lib/*; the two stay
// siblings. CI stages the VMM binary during publish (it's absent in
// the repo so `git status` stays clean); the e2fsprogs/squashfs
// binaries are committed.
const here = dirname(fileURLToPath(import.meta.url));

// --- VMM (the per-guest hypervisor process) ----------------------------

/** The microVM hypervisor binary the runtime spawns per guest. */
export const binary = join(here, "vmm", "bin", "machinen-vm");
/** Host-side Zig helper for runtime-owned native operations. */
export const runtimeHelper = join(here, "vmm", "bin", "machinen-runtime-helper");
/** Portable host terminal session multiplexer. */
export const session = join(here, "vmm", "bin", "machinen-session");
/** Parent-death wrapper used to keep host sidecars bound to the runtime process. */
export const pdeathsig = join(here, "vmm", "bin", "machinen-pdeathsig");
/** Native PTY shim used by bootPty(). */
export const pty = join(here, "vmm", "bin", "machinen-pty");
/** Native winsize socket forwarder used by VsockWinsize. */
export const winsize = join(here, "vmm", "bin", "machinen-winsize");
/**
 * gvproxy (containers/gvisor-tap-vsock) — the userspace TCP/IP sidecar
 * the runtime auto-spawns for virtio-net. Optional; absent installs
 * just boot without a network.
 */
export const gvproxy = join(here, "vmm", "bin", "gvproxy");

// Guest ELFs and restore worker the runtime reads to build the
// initramfs cpio at boot(). Read as data, never exec()d on the host.
export const initPath = join(here, "vmm", "guest", "init");
export const execAgentPath = join(here, "vmm", "guest", "exec-agent");
export const supervisorPath = join(here, "vmm", "guest", "machinen-supervisor");
export const restorePath = join(here, "vmm", "guest", "machinen-restore");

// --- e2fsprogs / squashfs-tools ----------------------------------------

/** Bundled `mke2fs` — materializes ext4 rootfs images without a host install. */
export const mke2fs = join(here, "e2fsprogs", "bin", "mke2fs");
/** Bundled `mksquashfs` — builds the read-only squashfs lower for `--mount` overlays. */
export const mksquashfs = join(here, "squashfs", "bin", "mksquashfs");
