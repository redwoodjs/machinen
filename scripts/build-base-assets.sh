#!/usr/bin/env bash
# Produce the release assets that ship alongside every tag:
#
#   Image-arm64                    ← Debian cloud arm64 kernel
#   virt-arm64.dtb                 ← compiled device tree
#   rootfs-debian-arm64.tar.gz     ← debian minbase + /init + /exec-agent
#   modules-arm64.tar.gz           ← flat tar of the .ko files /init loads
#                                    via finit_module (boot-path drivers).
#                                    Used by the tiny initramfs path that
#                                    ships per-VM (#119); avoids dragging
#                                    /lib/modules + kmod into RAM at boot.
#   *.sha256                       ← integrity sidecars
#
# Inputs (relative to repo root):
#   packages/microvm/assets/virt.dts
#   packages/microvm/assets/init.zig
#   packages/microvm/assets/exec-agent.zig
#   packages/microvm/assets/machinen-netup.c
#   packages/microvm/assets/lo-up.zig         ← CRIU plumbing (loopback ioctl)
#   packages/microvm/assets/no-iou.zig        ← CRIU plumbing (block io_uring)
#   packages/microvm/assets/poweroff.zig      ← clean shutdown → PSCI SYSTEM_OFF
#
# Also baked into the rootfs (downloaded at build time, not sourced):
#   fnm @ /usr/local/bin/fnm  ← Node version manager (#88).
#                                Points at the host-side cache via
#                                FNM_NODE_DIST_MIRROR (wired in
#                                packages/runtime/src/index.ts#spawn).
#
# Requirements:
#   - docker (with arm64 emulation; GH runners have this by default via
#     docker/setup-qemu-action)
#   - dtc  (device-tree-compiler; apt: device-tree-compiler, brew: dtc)
#   - zig  (0.14+; the release workflow installs it)
#   - curl, unzip  (for downloading and unpacking fnm)
#
# Outputs to ./release-assets/ at the repo root.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ASSETS="${ROOT}/packages/microvm/assets"
OUT="${ROOT}/release-assets"
# Per-tarball materialized ext4 images live here, keyed by sha256 of
# the source rootfs-debian-arm64.tar.gz. A fresh build always produces
# a new sha (mtimes / content shift), so old .img files are unreferenced
# the moment this script finishes — wipe them so users don't pile up
# stale GBs and so the next boot rematerializes against the new rootfs.
ROOTFS_IMG_CACHE="${HOME}/.cache/machinen/rootfs"

mkdir -p "$OUT"
rm -f "$OUT"/*
rm -rf "${ROOTFS_IMG_CACHE:?}"/*.img "${ROOTFS_IMG_CACHE:?}"/*-staging-* 2>/dev/null || true

# ------------------------------------------------------------
# 1. Kernel — Debian cloud-arm64
# ------------------------------------------------------------

echo "==> Extracting arm64 kernel from debian:bookworm-slim"
docker run --rm --platform linux/arm64 -v "$OUT":/out \
  debian:bookworm-slim bash -c '
    apt-get update -qq > /dev/null &&
    apt-get install -y --no-install-recommends linux-image-cloud-arm64 > /dev/null &&
    cp /boot/vmlinuz-* /out/Image-arm64
  '

# ------------------------------------------------------------
# 2. Device tree blob
# ------------------------------------------------------------

echo "==> Compiling virt.dts -> virt-arm64.dtb"
dtc -I dts -O dtb "${ASSETS}/virt.dts" -o "${OUT}/virt-arm64.dtb"

# ------------------------------------------------------------
# 3. Guest binaries: /init + /exec-agent + /sbin/machinen-netup
#    (all statically linked against musl)
# ------------------------------------------------------------

echo "==> Building guest binaries (init, exec-agent, fuse-agent, winsize-agent, CRIU helpers, poweroff, net-bench-probe) for aarch64-linux-musl"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# init + exec-agent + fuse-agent land at /init, /exec-agent, /fuse-agent
# (machinen-owned root entrypoints). lo-up, no-iou, poweroff are
# machinen-namespaced helpers needed by any CRIU-based snapshot flow;
# they go under /sbin with the machinen- prefix alongside machinen-netup.
# net-bench-probe is the #82 gvproxy throughput/latency probe used by
# the smoke harness. fuse-agent is the guest byte-pump for #78
# `--mount-live`; /init forks it per liveMount entry.
# winsize-agent is the #177 vsock TIOCSWINSZ daemon for dev-VM tty
# resize forwarding; lives at /sbin/machinen-winsize-agent and is
# launched by vm.ts's bootstrap (no auto-launch in non-dev paths).
for name in init exec-agent fuse-agent winsize-agent lo-up no-iou poweroff net-bench-probe; do
  zig build-exe "${ASSETS}/${name}.zig" \
    -target aarch64-linux-musl \
    -O ReleaseSmall \
    -lc \
    -femit-bin="${STAGE}/${name}"
  rm -f "${STAGE}/${name}.o"
done

zig cc "${ASSETS}/machinen-netup.c" \
  -target aarch64-linux-musl \
  -static \
  -Os \
  -o "${STAGE}/machinen-netup"

# Refresh the in-tree /init that mkinitramfs.packTinyBundle() reads via
# defaultInitPath() (packages/runtime/src/mkinitramfs.ts). Without this,
# every user-facing boot() ships the binary that was checked in last,
# regardless of how often you rerun this script — release-assets gets
# the new /init, the tiny initramfs path keeps using the stale one, and
# rootDisk: true boots silently regress. See issue #129.
TEST_FIXTURES="${ROOT}/packages/microvm/test-fixtures"
mkdir -p "${TEST_FIXTURES}"
install -m 0755 "${STAGE}/init"        "${TEST_FIXTURES}/init"
install -m 0755 "${STAGE}/exec-agent"  "${TEST_FIXTURES}/exec-agent"
install -m 0755 "${STAGE}/fuse-agent"  "${TEST_FIXTURES}/fuse-agent"

# ------------------------------------------------------------
# 3a. fnm — Node version manager (#88)
# ------------------------------------------------------------
# Single static Rust binary from the upstream release. Pinned by
# version + sha256 so rebuilds are reproducible and a compromised
# upstream can't slip a different binary past us. The host-side cache
# in packages/runtime/src/artifact-cache.ts fronts nodejs.org/dist
# for the fnm-managed Node downloads; fnm itself still comes from
# GitHub at build time.

echo "==> Downloading fnm (static arm64 binary)"
FNM_VERSION="1.38.1"
FNM_SHA256="69feda9455931c26c84be9f95f5e6f69e8b64686e68069fab7cfc34756cd2944"
FNM_URL="https://github.com/Schniz/fnm/releases/download/v${FNM_VERSION}/fnm-arm64.zip"
curl -fsSL -o "${STAGE}/fnm.zip" "$FNM_URL"
echo "${FNM_SHA256}  ${STAGE}/fnm.zip" | shasum -a 256 -c -
unzip -q -o "${STAGE}/fnm.zip" -d "${STAGE}"
chmod +x "${STAGE}/fnm"

# Stage the shell-script helpers that implement the snapshot contract
# (supervisor, dump, restore). They end up under /sbin/machinen-* inside
# the guest — see the `install -m 0755` block further down.
cp "${ASSETS}/machinen-supervisor.sh" "${STAGE}/machinen-supervisor.sh"
cp "${ASSETS}/machinen-dump.sh"       "${STAGE}/machinen-dump.sh"
cp "${ASSETS}/machinen-restore.sh"    "${STAGE}/machinen-restore.sh"
chmod +x "${STAGE}/machinen-supervisor.sh" "${STAGE}/machinen-dump.sh" "${STAGE}/machinen-restore.sh"

# ------------------------------------------------------------
# 4. Rootfs — mmdebstrap minbase + aggressive strip + guest binaries
# ------------------------------------------------------------
#
# Single docker run: build inside the container's own filesystem and
# only write the final tarball to the bind-mounted /out. Reason:
# Docker Desktop on darwin uses virtio-fs for bind mounts, and dpkg
# install touches symlinks (e.g. /usr/share/man/man7/pam.7.gz) that
# trigger I/O errors through virtio-fs under qemu emulation. Building
# on the container's overlay2 sidesteps that entirely.
#
# --privileged: mmdebstrap needs CAP_SYS_ADMIN for `unshare --mount`.
# gpg + debian-archive-keyring: required to verify the Release signature.
# --setup-hook: pre-seeds dpkg path-excludes BEFORE essential package
#   install, so man/doc/info are never unpacked to begin with.

echo "==> Building minimal Debian arm64 rootfs via mmdebstrap"

docker run --rm -i --privileged --platform linux/arm64 \
  -v "${STAGE}":/stage:ro \
  -v "$OUT":/out \
  debian:bookworm-slim bash -s <<'CONTAINER_SCRIPT'
set -euo pipefail

apt-get update -qq > /dev/null
apt-get install -y --no-install-recommends \
  mmdebstrap gpg debian-archive-keyring > /dev/null

mkdir -p /work

cat > /tmp/setup-hook.sh <<'HOOK'
#!/bin/sh
set -e
mkdir -p "$1/etc/dpkg/dpkg.cfg.d" "$1/etc/apt/apt.conf.d"
cat > "$1/etc/dpkg/dpkg.cfg.d/99-machinen" <<EOF
path-exclude /usr/share/doc/*
path-exclude /usr/share/man/*
path-exclude /usr/share/info/*
path-exclude /usr/share/locale/*
path-include /usr/share/locale/en*
EOF
cat > "$1/etc/apt/apt.conf.d/99-machinen" <<EOF
APT::Install-Recommends "false";
APT::Install-Suggests  "false";
EOF
HOOK
chmod +x /tmp/setup-hook.sh

# linux-image-cloud-arm64 + kmod: the Debian cloud kernel we ship
# (scripts/build-base-assets.sh section 1) carries virtio_mmio /
# virtio_net as modules, not built-in. Without /lib/modules inside
# the guest and modprobe to load them, the kernel sees virtio-mmio
# devices in the DTB but has no driver to bind to them — no eth0,
# no networking. Install the matching kernel package and kmod;
# /init will `modprobe virtio_net` via /sbin/machinen-netup at boot.
#
# criu: required by any snapshot flow (`build()` dumps at freeze
# time, `spawn({ snapshot })` restores at boot time). Pulls ~5MB of
# libs (libnl, libprotobuf-c, libnftables). The criu-ns shell helper
# that solves PID collisions across boots ships in the same package.
# APT::Install-Recommends "false" is already set by the setup hook,
# so criu's optional python3 suggestion is skipped.
#
# e2fsprogs: mkfs.ext4 + blkid. /sbin/machinen-dump formats /dev/vda
# on first snapshot so CRIU has a filesystem to write images into;
# /sbin/machinen-restore uses blkid to verify before mounting.
#
# mount: util-linux's `mount` / `umount` are Essential on Debian,
# so they ride in with minbase — no extra --include line needed.
#
# iputils-ping: baked in so users can sanity-check connectivity
# without an `apt install`. Over gvproxy ICMP works via unprivileged
# ping sockets (sysctl is enabled in cloud kernels).
mmdebstrap \
  --variant=minbase \
  --architectures=arm64 \
  --include=linux-image-cloud-arm64,kmod,criu,e2fsprogs,iputils-ping \
  --setup-hook=/tmp/setup-hook.sh \
  bookworm /work/rootfs

# linux-image-cloud-arm64 ships every driver the Debian cloud kernel
# knows about (~28MB of .ko). Keep only the modules the base flow
# actually loads:
#
#   Networking at boot (see machinen-netup.c):
#     virtio, virtio_ring, virtio_mmio, virtio_net, net_failover, failover
#
#   Block device for snapshot images + persistent workspaces:
#     virtio_blk
#
#   Socket state diag — CRIU walks these to dump/restore sockets.
#   Missing any of them makes `criu dump` fail with obscure kerndat
#   errors on a process that touches sockets (i.e. most of them).
#   sock_diag itself is built into the Debian cloud kernel
#   (CONFIG_SOCK_DIAG=y), so only the per-family backends need to
#   be kept as modules:
#     netlink_diag, unix_diag, inet_diag, tcp_diag, udp_diag,
#     af_packet_diag
#
#   Netfilter + crc32c — defensively kept for processes that hold
#   any iptables/nftables state. CRIU loads these lazily during
#   dump; cheap to bake in:
#     libcrc32c, nfnetlink, nf_tables
#
#   AF_VSOCK — the build()/spawn() install-hook flow drives the guest
#   via a vsock exec-agent. CONFIG_VSOCKETS=m in the Debian cloud
#   kernel, so we have to ship the module set; /init modprobes them
#   at boot so userspace can `socket(AF_VSOCK, SOCK_STREAM, 0)`.
#   vsock_diag is for CRIU walking vsock connections at dump time:
#     vsock, vmw_vsock_virtio_transport,
#     vmw_vsock_virtio_transport_common, vsock_diag
#
#   FUSE — `--mount-live` (#78) relays guest filesystem ops over vsock
#   to a host-side server. The guest side is a FUSE daemon that talks
#   to /dev/fuse; it only gets loaded when a live mount is requested,
#   so this is opt-in at /init time rather than on every boot.
#
# Resolve each module by filename (find) rather than hard-coded path,
# so the whitelist is robust to Debian kernel-package layout changes.
#
# Two destinations:
#   /work/rootfs/lib/modules/$KVER/kernel/  — for criu / modprobe inside
#       the legacy fat-cpio path (provision()'s boot still has a full
#       Debian userland and runs criu against /lib/modules).
#   /work/rootfs/modules/                   — flat directory, what
#       /init reads at boot via finit_module(2). Sourced into the tiny
#       cpio used by every user-facing boot() (#119); also present in
#       the fat tarball so /init takes the same path in both modes.
#
# /out/modules-arm64.tar.gz: the same flat /modules/ shipped on its own
# so mkinitramfs can pull it into the tiny cpio without untar-ing the
# whole rootfs.
KVER=$(ls /work/rootfs/lib/modules | head -1)
KMODS=/work/rootfs/lib/modules/$KVER/kernel
FLAT=/work/rootfs/modules
STAGE=$(mktemp -d)
mkdir -p "$FLAT"
for m in \
  virtio virtio_ring virtio_mmio virtio_net net_failover failover \
  virtio_blk \
  netlink_diag unix_diag inet_diag tcp_diag udp_diag af_packet_diag \
  libcrc32c nfnetlink nf_tables \
  vsock vmw_vsock_virtio_transport vmw_vsock_virtio_transport_common vsock_diag \
  fuse
do
  src=$(find "$KMODS" -type f -name "$m.ko" | head -1)
  [ -n "$src" ] || { echo "missing module: $m.ko" >&2; exit 1; }
  rel=${src#$KMODS/}
  mkdir -p "$STAGE/$(dirname "$rel")"
  cp "$src" "$STAGE/$rel"
  cp "$src" "$FLAT/$m.ko"
done
rm -rf "$KMODS"
mkdir -p "$KMODS"
cp -a "$STAGE/." "$KMODS/"
rm -rf "$STAGE"

# Depmod so modprobe (called by criu inside the fat-cpio provision
# path) can resolve dependencies without a live uname.
chroot /work/rootfs depmod -a "$KVER"

# Pack the flat /modules/ as a standalone artifact for the tiny-cpio
# path. Deterministic tar so the sha256 sidecar is reproducible across
# rebuilds.
tar --sort=name --owner=0 --group=0 --numeric-owner \
  --mtime="2020-01-01 00:00Z" \
  -C /work/rootfs/modules -cf - . |
gzip -n > /out/modules-arm64.tar.gz

# Belt-and-braces cleanup for things path-exclude doesn't cover.
# Also drop the second copy of the kernel image and initrd hooks we
# don't use (we boot Image-arm64 from release-assets, not from
# inside the guest's /boot).
#
# Python: criu Depends on python3-protobuf for the `crit` image-debug
# tool. crit is the only python caller; we don't run it. Deleting the
# interpreter + stdlib after install (rather than path-excluding during
# install, which breaks python's own postinst) saves ~30 MB extracted
# / ~10 MB gz. dpkg's database still lists the packages as installed
# (`dpkg -l` shows ii) — only the on-disk files are gone.
rm -rf \
  /work/rootfs/usr/share/man \
  /work/rootfs/usr/share/doc \
  /work/rootfs/usr/share/info \
  /work/rootfs/usr/bin/python3 /work/rootfs/usr/bin/python3.* \
  /work/rootfs/usr/lib/python3 \
  /work/rootfs/usr/lib/python3.* \
  /work/rootfs/usr/share/python3 \
  /work/rootfs/var/cache/apt/archives/*.deb \
  /work/rootfs/var/lib/apt/lists/* \
  /work/rootfs/var/log/* \
  /work/rootfs/boot/* \
  /work/rootfs/etc/kernel
find /work/rootfs/usr/share/locale -mindepth 1 -maxdepth 1 \
  ! -name "en*" -exec rm -rf {} + 2>/dev/null || true

# Strip /dev/* device nodes. Two reasons:
#   1) devtmpfs at boot populates /dev with real nodes anyway.
#   2) Character-device entries in a tar archive can't be extracted as
#      a non-root user (e.g. during `mkinitramfs` on darwin) — mknod
#      requires CAP_MKNOD.
# Keep /dev itself as an empty directory so the kernel has somewhere
# to mount devtmpfs.
rm -rf /work/rootfs/dev
mkdir -m 0755 /work/rootfs/dev

# DNS resolver. gvproxy (containers/gvisor-tap-vsock) runs its own DNS
# forwarder on the gateway IP (192.168.127.1). Without a resolv.conf,
# glibc falls back to 127.0.0.1 which has nothing listening —
# `apt-get update` and any other hostname lookup will fail.
echo "nameserver 192.168.127.1" > /work/rootfs/etc/resolv.conf

install -m 0755 /stage/init       /work/rootfs/init
install -m 0755 /stage/exec-agent /work/rootfs/exec-agent
install -m 0755 /stage/fuse-agent /work/rootfs/fuse-agent
install -m 0755 -D /stage/machinen-netup    /work/rootfs/sbin/machinen-netup
install -m 0755 -D /stage/lo-up             /work/rootfs/sbin/machinen-lo-up
install -m 0755 -D /stage/no-iou            /work/rootfs/sbin/machinen-no-iou
install -m 0755 -D /stage/poweroff          /work/rootfs/sbin/machinen-poweroff
install -m 0755 -D /stage/net-bench-probe   /work/rootfs/sbin/machinen-net-bench-probe
install -m 0755 -D /stage/winsize-agent     /work/rootfs/sbin/machinen-winsize-agent
install -m 0755 -D /stage/fnm               /work/rootfs/usr/local/bin/fnm
# Shell-script helpers that drive the snapshot/restore contract. Staged
# in by the host-side build step alongside the zig binaries.
install -m 0755 -D /stage/machinen-supervisor.sh /work/rootfs/sbin/machinen-supervisor
install -m 0755 -D /stage/machinen-dump.sh       /work/rootfs/sbin/machinen-dump
install -m 0755 -D /stage/machinen-restore.sh    /work/rootfs/sbin/machinen-restore

# Deterministic tar + gzip written as a single file to the bind mount.
tar --sort=name --owner=0 --group=0 --numeric-owner \
  --mtime="2020-01-01 00:00Z" \
  -C /work/rootfs -cf - . |
gzip -n > /out/rootfs-debian-arm64.tar.gz
CONTAINER_SCRIPT

# ------------------------------------------------------------
# 5. Sha256 sidecars
# ------------------------------------------------------------

echo "==> Writing sha256 sidecars"
cd "$OUT"
for f in Image-arm64 virt-arm64.dtb rootfs-debian-arm64.tar.gz modules-arm64.tar.gz; do
  shasum -a 256 "$f" > "${f}.sha256"
done

ls -lh "$OUT"
echo "==> Done."
