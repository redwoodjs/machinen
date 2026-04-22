#!/usr/bin/env bash
# Produce the release assets that ship alongside every tag:
#
#   Image-arm64                    ← Debian cloud arm64 kernel
#   virt-arm64.dtb                 ← compiled device tree
#   rootfs-debian-arm64.tar.gz     ← debian minbase + /init + /exec-agent
#   *.sha256                       ← integrity sidecars
#
# Inputs (relative to repo root):
#   packages/microvm/test-fixtures/virt.dts
#   packages/microvm/test-fixtures/init.zig
#   packages/microvm/test-fixtures/exec-agent.zig
#   packages/microvm/test-fixtures/machinen-netup.c
#
# Requirements:
#   - docker (with arm64 emulation; GH runners have this by default via
#     docker/setup-qemu-action)
#   - dtc  (device-tree-compiler; apt: device-tree-compiler, brew: dtc)
#   - zig  (0.14+; the release workflow installs it)
#
# Outputs to ./release-assets/ at the repo root.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
FIXTURES="${ROOT}/packages/microvm/test-fixtures"
OUT="${ROOT}/release-assets"

mkdir -p "$OUT"
rm -f "$OUT"/*

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
dtc -I dts -O dtb "${FIXTURES}/virt.dts" -o "${OUT}/virt-arm64.dtb"

# ------------------------------------------------------------
# 3. Guest binaries: /init + /exec-agent + /sbin/machinen-netup
#    (all statically linked against musl)
# ------------------------------------------------------------

echo "==> Building guest binaries (init, exec-agent, machinen-netup) for aarch64-linux-musl"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

for name in init exec-agent; do
  zig build-exe "${FIXTURES}/${name}.zig" \
    -target aarch64-linux-musl \
    -O ReleaseSmall \
    -lc \
    -femit-bin="${STAGE}/${name}"
  rm -f "${STAGE}/${name}.o"
done

zig cc "${FIXTURES}/machinen-netup.c" \
  -target aarch64-linux-musl \
  -static \
  -Os \
  -o "${STAGE}/machinen-netup"

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
mmdebstrap \
  --variant=minbase \
  --architectures=arm64 \
  --include=linux-image-cloud-arm64,kmod \
  --setup-hook=/tmp/setup-hook.sh \
  bookworm /work/rootfs

# linux-image-cloud-arm64 ships every driver the Debian cloud kernel
# knows about (~28MB of .ko). We only ever modprobe a handful at boot
# (see packages/microvm/test-fixtures/machinen-netup.c), so prune
# the rest. Saves roughly 25MB on the rootfs tarball.
KVER=$(ls /work/rootfs/lib/modules | head -1)
KMODS=/work/rootfs/lib/modules/$KVER/kernel
STAGE=$(mktemp -d)
for f in \
  drivers/virtio/virtio.ko \
  drivers/virtio/virtio_ring.ko \
  drivers/virtio/virtio_mmio.ko \
  drivers/net/virtio_net.ko \
  drivers/net/net_failover.ko \
  net/core/failover.ko
do
  [ -f "$KMODS/$f" ] || { echo "missing module: $f" >&2; exit 1; }
  mkdir -p "$STAGE/$(dirname "$f")"
  mv "$KMODS/$f" "$STAGE/$f"
done
rm -rf "$KMODS"
mkdir -p "$KMODS"
cp -a "$STAGE/." "$KMODS/"
rm -rf "$STAGE"

# Depmod so modprobe can resolve dependencies without a live uname.
chroot /work/rootfs depmod -a "$KVER"

# Belt-and-braces cleanup for things path-exclude doesn't cover.
# Also drop the second copy of the kernel image and initrd hooks we
# don't use (we boot Image-arm64 from release-assets, not from
# inside the guest's /boot).
rm -rf \
  /work/rootfs/usr/share/man \
  /work/rootfs/usr/share/doc \
  /work/rootfs/usr/share/info \
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

# DNS resolver. SLIRP (see packages/microvm/src/slirp.zig) exposes a
# virtual nameserver at 10.0.2.3. Without a resolv.conf, glibc falls
# back to 127.0.0.1 which has nothing listening — `apt-get update`
# and any other hostname lookup will fail.
echo "nameserver 10.0.2.3" > /work/rootfs/etc/resolv.conf

install -m 0755 /stage/init       /work/rootfs/init
install -m 0755 /stage/exec-agent /work/rootfs/exec-agent
install -m 0755 -D /stage/machinen-netup /work/rootfs/sbin/machinen-netup

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
for f in Image-arm64 virt-arm64.dtb rootfs-debian-arm64.tar.gz; do
  shasum -a 256 "$f" > "${f}.sha256"
done

ls -lh "$OUT"
echo "==> Done."
