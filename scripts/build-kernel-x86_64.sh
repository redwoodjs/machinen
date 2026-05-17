#!/usr/bin/env bash
# Build a custom x86_64 Linux bzImage for the KVM boot path (#362).
# Like build-kernel-arm64.sh, all boot-path drivers are built in so the
# initramfs does not need /lib/modules just to mount /dev/vda or bring up
# vsock/net/live-mounts.

set -euo pipefail

KVER="${KVER:-6.12.20}"
WORKDIR="${WORKDIR:-$HOME/.cache/machinen/kernel-x86_64}"
OUT="${OUT:-$WORKDIR/bzImage-x86_64}"
NPROC=$(nproc)
JOBS="${JOBS:-$((NPROC < 8 ? NPROC : 8))}"

mkdir -p "$WORKDIR"
cd "$WORKDIR"

SRC="linux-${KVER}"
TARBALL="${SRC}.tar.xz"

if [ ! -f "$TARBALL" ]; then
  major=$(echo "$KVER" | cut -d. -f1)
  curl -fsSL "https://cdn.kernel.org/pub/linux/kernel/v${major}.x/${TARBALL}" -o "$TARBALL.tmp"
  mv "$TARBALL.tmp" "$TARBALL"
fi

PATCHES_DIR="${PATCHES_DIR:-}"
PATCH_HASH=""
if [ -n "$PATCHES_DIR" ] && [ -d "$PATCHES_DIR" ]; then
  PATCH_HASH=$(find "$PATCHES_DIR" -maxdepth 1 -name '*.patch' -type f -print0 \
    | sort -z | xargs -0 sha256sum 2>/dev/null \
    | sha256sum | cut -d' ' -f1)
fi
APPLIED_HASH_FILE="$WORKDIR/$SRC/.machinen-patch-hash"

if [ -d "$SRC" ] && [ -n "$PATCH_HASH" ]; then
  if [ ! -f "$APPLIED_HASH_FILE" ] || [ "$(cat "$APPLIED_HASH_FILE")" != "$PATCH_HASH" ]; then
    echo "==> Patch set changed (hash $PATCH_HASH) — re-extracting source tree"
    rm -rf "$SRC"
  fi
fi

if [ ! -d "$SRC" ]; then
  tar -xf "$TARBALL"
fi

cd "$SRC"

if [ -n "$PATCHES_DIR" ] && [ -d "$PATCHES_DIR" ]; then
  shopt -s nullglob
  for p in "$PATCHES_DIR"/*.patch; do
    name=$(basename "$p")
    if patch -p1 -F0 -R --dry-run < "$p" >/dev/null 2>&1; then
      echo "==> Skipping kernel patch (already applied): $name"
      continue
    fi
    echo "==> Applying kernel patch: $name"
    if ! patch -p1 -F0 --dry-run < "$p" >/dev/null 2>&1; then
      echo "build-kernel-x86_64: patch refused to apply: $p" >&2
      patch -p1 -F0 --dry-run < "$p" >&2 || true
      exit 1
    fi
    patch -p1 -F0 < "$p"
  done
  shopt -u nullglob
  echo "$PATCH_HASH" > .machinen-patch-hash
fi

make ARCH=x86 defconfig >/dev/null

./scripts/config \
  --enable 64BIT \
  --enable VIRTIO --enable VIRTIO_MMIO --enable VIRTIO_MMIO_CMDLINE_DEVICES \
  --enable VIRTIO_BLK --enable VIRTIO_NET \
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
  --enable FUSE_FS --enable VIRTIO_FS \
  --enable SQUASHFS --enable SQUASHFS_ZSTD --enable OVERLAY_FS \
  --enable IKCONFIG --enable IKCONFIG_PROC \
  --enable CHECKPOINT_RESTORE --enable KCMP \
  --enable USER_NS --enable PID_NS --enable NET_NS \
  --enable VIRTIO_BALLOON --enable PAGE_REPORTING \
  --enable SERIAL_8250 --enable SERIAL_8250_CONSOLE \
  --enable ACPI --enable ACPI_SLEEP --enable X86_IO_APIC

make ARCH=x86 olddefconfig >/dev/null

required=(
  VIRTIO VIRTIO_MMIO VIRTIO_MMIO_CMDLINE_DEVICES VIRTIO_BLK VIRTIO_NET
  NET_FAILOVER FAILOVER
  EXT4_FS
  VSOCKETS VIRTIO_VSOCKETS
  VETH
  NF_TABLES NF_TABLES_INET NETFILTER_NETLINK
  NFT_CT
  NF_CONNTRACK
  USERFAULTFD
  IPV6
  VIRTIO_BALLOON PAGE_REPORTING
  SQUASHFS SQUASHFS_ZSTD OVERLAY_FS
  FUSE_FS VIRTIO_FS
  SERIAL_8250 SERIAL_8250_CONSOLE
  ACPI X86_IO_APIC
)
for c in "${required[@]}"; do
  if ! grep -q "^CONFIG_${c}=y" .config; then
    echo "build-kernel-x86_64: CONFIG_${c} is not =y after olddefconfig" >&2
    grep "^# CONFIG_${c}" .config 2>&1 || true
    grep "^CONFIG_${c}=" .config 2>&1 || true
    exit 1
  fi
done

HARDLIMIT=$(ulimit -Hn 2>/dev/null || echo 1048576)
ulimit -n $((HARDLIMIT < 1048576 ? HARDLIMIT : 1048576)) 2>/dev/null || true

make ARCH=x86 -j"$JOBS" bzImage

cp arch/x86/boot/bzImage "$OUT"
echo "build-kernel-x86_64: wrote $OUT ($(du -h "$OUT" | cut -f1))"
