#!/usr/bin/env bash
# Produce the release assets that ship alongside every tag:
#
#   Image-arm64                    ← Debian cloud arm64 kernel
#   virt-arm64.dtb                 ← compiled device tree
#   rootfs-debian-arm64.tar.gz     ← node:lts-slim + /init + /exec-agent
#   *.sha256                       ← integrity sidecars
#
# Inputs (relative to repo root):
#   packages/microvm/assets/virt.dts
#   packages/microvm/assets/init.zig
#   packages/microvm/assets/exec-agent.zig
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
ASSETS="${ROOT}/packages/microvm/assets"
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
dtc -I dts -O dtb "${ASSETS}/virt.dts" -o "${OUT}/virt-arm64.dtb"

# ------------------------------------------------------------
# 3. Guest binaries: /init + /exec-agent, statically linked musl
# ------------------------------------------------------------

echo "==> Building guest binaries (init, exec-agent) for aarch64-linux-musl"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

for name in init exec-agent; do
  zig build-exe "${ASSETS}/${name}.zig" \
    -target aarch64-linux-musl \
    -O ReleaseSmall \
    -lc \
    -femit-bin="${STAGE}/${name}"
  rm -f "${STAGE}/${name}.o"
done

# ------------------------------------------------------------
# 4. Rootfs tarball — node:lts-slim arm64 + injected guest binaries
# ------------------------------------------------------------

echo "==> Exporting node:lts-slim arm64 rootfs + injecting guest binaries"
CID=$(docker create --platform linux/arm64 node:lts-slim sleep 0)
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true; rm -rf "$STAGE"' EXIT

ROOTFS_STAGE="${STAGE}/rootfs"
mkdir -p "$ROOTFS_STAGE"
docker export "$CID" | tar -x -C "$ROOTFS_STAGE"

install -m 0755 "${STAGE}/init" "${ROOTFS_STAGE}/init"
install -m 0755 "${STAGE}/exec-agent" "${ROOTFS_STAGE}/exec-agent"

# Deterministic tar + gzip. We run this inside a container so the flags
# (`--sort`, `--mtime`, `--owner`, `--group`, `--numeric-owner`) behave
# consistently on Linux runners + darwin dev boxes; BSD tar on macOS
# doesn't support these options.
docker run --rm \
  -v "$ROOTFS_STAGE":/rootfs:ro \
  -v "$OUT":/out \
  debian:bookworm-slim bash -c '
    tar --sort=name --owner=0 --group=0 --numeric-owner \
      --mtime="2020-01-01 00:00Z" \
      -C /rootfs -cf - . |
    gzip -n > /out/rootfs-debian-arm64.tar.gz
  '

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
