#!/usr/bin/env bash
# Build a custom arm64 Linux kernel with the boot-path drivers compiled
# in instead of left as modules. Replaces the apt-installed Debian
# `linux-image-cloud-arm64` we shipped before #119: with virtio_*, ext4,
# vsock, and CRIU's sock_diag families baked into vmlinux, the cpio no
# longer has to ship /lib/modules + kmod + libc just to mount /dev/vda.
#
# Inputs (env vars):
#   KVER     — kernel version (default: 6.12.20)
#   WORKDIR  — host workdir (default: $HOME/.cache/machinen/kernel)
#   OUT      — final Image-arm64 path (default: $WORKDIR/Image-arm64)
#   JOBS     — parallel make jobs (default: $(nproc))
#
# Output:
#   $OUT — uncompressed arm64 kernel `Image` (boots the same way the
#   Debian cloud kernel did; same ABI for our HVF VMM).
#
# Designed to run on a native arm64 Linux box. The host needs gcc, make,
# bc, flex, bison, libssl-dev, libelf-dev, cpio, xz-utils. Building under
# qemu-arm64 emulation works but takes hours — for darwin/macOS dev,
# delegate to a remote arm64 builder via build-base-assets.sh's
# MACHINEN_REMOTE_BUILDER env var instead of running this directly.

set -euo pipefail

KVER="${KVER:-6.12.20}"
WORKDIR="${WORKDIR:-$HOME/.cache/machinen/kernel}"
OUT="${OUT:-$WORKDIR/Image-arm64}"
# Cap parallel jobs at 8. 20-way parallel cc1 on a fat host (DGX Spark)
# can blow past container fd limits with "Too many open files" on
# header-heavy translation units; 8-way is still <2 min on modern arm64.
NPROC=$(nproc)
JOBS="${JOBS:-$((NPROC < 8 ? NPROC : 8))}"

mkdir -p "$WORKDIR"
cd "$WORKDIR"

SRC="linux-${KVER}"
TARBALL="${SRC}.tar.xz"

if [ ! -f "$TARBALL" ]; then
  # kernel.org organizes by major series; v6.x covers 6.0 through 6.99.
  major=$(echo "$KVER" | cut -d. -f1)
  curl -fsSL "https://cdn.kernel.org/pub/linux/kernel/v${major}.x/${TARBALL}" -o "$TARBALL.tmp"
  mv "$TARBALL.tmp" "$TARBALL"
fi

if [ ! -d "$SRC" ]; then
  tar -xf "$TARBALL"
fi

cd "$SRC"

# Start from arm64 defconfig — sane Cortex-A baseline with PSCI, PL011
# console, GICv3, devtmpfs, sysfs, procfs already enabled.
make ARCH=arm64 defconfig >/dev/null

# Bake in the boot-path drivers + criu plumbing. =y everywhere; no
# modules, no /lib/modules in the guest.
#
# Block + net + fs (the actual point of #119):
#   VIRTIO_*       — bus + ring + mmio + blk + net so /dev/vda and eth0
#                    appear before /init runs.
#   FAILOVER /     — virtio_net's standby pair; auto-selected when
#   NET_FAILOVER     VIRTIO_NET=y but pin them anyway so olddefconfig
#                    can't strip them.
#   EXT4_FS        — root filesystem on /dev/vda.
#
# CRIU socket-diag families — criu walks these to dump/restore sockets
# at snapshot time. Missing any breaks `criu dump` with kerndat errors.
#
# vsock — exec-agent's transport. machinen-supervisor talks to the
# host over vsock; without VSOCKETS + virtio transport, vm.exec breaks.
#
# Netfilter — defensively kept for processes that hold iptables/nftables
# state at dump time. NF_TABLES + NETFILTER_NETLINK alone is not enough:
# CRIU's kerndat probes (run on every `criu dump`, not gated by flags)
# create an `inet`-AF nftables table and a concat-typed set to verify
# the kernel can support its restore plan. Without NF_TABLES_INET those
# probes return EOPNOTSUPP and dump bails before doing anything. NFT_CT
# covers connection-tracking expressions; NF_CONNTRACK is the underlying
# subsystem any restore that touches conntrack needs. The set types
# themselves (hash / rbtree / pipapo) are no longer separate Kconfig
# options in 6.x — NF_TABLES_CORE selects them in.
#
# VETH — CRIU's kerndat also creates a throwaway veth pair via netlink to
# verify RTM_NEWLINK. Without the veth driver this returns EOPNOTSUPP (-95)
# and the dump fails the same way. Independent of whether the workload
# uses veth — it's a probe.
#
# USERFAULTFD — CRIU's lazy-pages probe needs userfaultfd(2). Dump runs
# without it (just emits a warning), but restore can hang attempting to
# install pages via uffd. Built in.
#
# IPV6 — defconfig leaves this =m. CRIU restore walks IPv6 socket diag
# during the network-restore phase even when the workload only used
# IPv4, and a missing module here can hang the restore loop. Force =y
# to match the rest of the boot-path drivers.
#
# FUSE — guest side of `--mount-live` (#78). Builtin so liveMounts work
# without /init having to finit_module fuse first.
#
# CHECKPOINT_RESTORE / KCMP / namespace toggles — required by criu.
# Most are already =y in arm64 defconfig but pinning protects against
# upstream defconfig drift.
#
# IKCONFIG / IKCONFIG_PROC — surface the running kernel's config at
# /proc/config.gz so the test plan ("verify CONFIG_* are =y") can read
# it back at boot.
./scripts/config \
  --enable VIRTIO --enable VIRTIO_MMIO --enable VIRTIO_BLK --enable VIRTIO_NET \
  --enable NET_FAILOVER --enable FAILOVER \
  --enable EXT4_FS \
  --enable VSOCKETS --enable VIRTIO_VSOCKETS \
  --enable INET_DIAG --enable NETLINK_DIAG --enable UNIX_DIAG \
  --enable INET_TCP_DIAG --enable INET_UDP_DIAG \
  --enable PACKET_DIAG --enable VSOCKETS_DIAG \
  --enable NF_TABLES --enable NF_TABLES_INET --enable NETFILTER_NETLINK \
  --enable NF_CONNTRACK --enable NFT_CT \
  --enable VETH \
  --enable USERFAULTFD \
  --enable IPV6 \
  --enable LIBCRC32C \
  --enable FUSE_FS \
  --enable IKCONFIG --enable IKCONFIG_PROC \
  --enable CHECKPOINT_RESTORE --enable KCMP \
  --enable USER_NS --enable PID_NS --enable NET_NS

make ARCH=arm64 olddefconfig >/dev/null

# Verify the must-haves actually landed as built-in (not =m or unset).
# These are exactly what /init used to finit_module(2) before #119;
# if any are =m the cpio still has to ship them as .ko files and the
# whole point of this change is moot.
required=(
  VIRTIO VIRTIO_MMIO VIRTIO_BLK VIRTIO_NET
  NET_FAILOVER FAILOVER
  EXT4_FS
  VSOCKETS VIRTIO_VSOCKETS
  VETH
  NF_TABLES NF_TABLES_INET NETFILTER_NETLINK
  NFT_CT
  NF_CONNTRACK
  USERFAULTFD
  IPV6
)
for c in "${required[@]}"; do
  if ! grep -q "^CONFIG_${c}=y" .config; then
    echo "build-kernel-arm64: CONFIG_${c} is not =y after olddefconfig" >&2
    grep "^# CONFIG_${c}" .config 2>&1 || true
    grep "^CONFIG_${c}=" .config 2>&1 || true
    exit 1
  fi
done

# Build the uncompressed Image. Image.gz / Image.lz4 are smaller but our
# HVF VMM loader expects a raw `Image` and would have to learn to
# decompress; deferring that until the cpio shrink is verified.
#
# Bump the open-file limit before forking N parallel cc1's. Each
# compilation unit in the kernel #includes deep enough header trees
# that a 20-way parallel build (DGX Spark) trips over the default
# 1024 fd limit some container runtimes (agent-ci's ubuntu-arm runner)
# ship with. Linux's hard limit is plenty (1M+); raise to the lower
# of `ulimit -Hn` and 1048576.
HARDLIMIT=$(ulimit -Hn 2>/dev/null || echo 1048576)
ulimit -n $((HARDLIMIT < 1048576 ? HARDLIMIT : 1048576)) 2>/dev/null || true

make ARCH=arm64 -j"$JOBS" Image

cp arch/arm64/boot/Image "$OUT"
echo "build-kernel-arm64: wrote $OUT ($(du -h "$OUT" | cut -f1))"
