#!/usr/bin/env bash
# Build a static mksquashfs for arm64 linux and drop it at bin/mksquashfs.
#
# Same idiom as packages/e2fsprogs-arm64-linux/scripts/build.sh: build
# inside an Alpine container with build-base + musl, link statically,
# strip. The result runs on every Linux arm64 distribution because
# musl's libc is statically embedded.
#
# Why static + musl + Alpine: musl can be linked statically (glibc
# can't, in practice). Alpine is the smallest environment that ships
# the necessary build tools.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$PKG_DIR/bin/mksquashfs"
SQUASHFS_VERSION="${SQUASHFS_VERSION:-4.7.5}"

mkdir -p "$PKG_DIR/bin"

docker run --rm --platform=linux/arm64 \
  -v "$PKG_DIR/bin":/out \
  alpine:3.20 sh -eu -c "
    apk add --no-cache build-base linux-headers wget zstd-dev zstd-static \
                       lz4-dev lz4-static xz-dev xz-static \
                       zlib-dev zlib-static >/dev/null
    cd /tmp
    wget -q https://github.com/plougher/squashfs-tools/archive/refs/tags/${SQUASHFS_VERSION}.tar.gz -O sq.tar.gz
    tar xf sq.tar.gz
    cd squashfs-tools-${SQUASHFS_VERSION}/squashfs-tools
    # Build mksquashfs only — we don't need unsquashfs / sqfstar at
    # runtime. ZSTD_SUPPORT=1 matches the kernel's CONFIG_SQUASHFS_ZSTD.
    # XATTR_SUPPORT=0 strips xattr serialisation; we don't need it for
    # the per-mount payload (mtime/mode/symlink-target round-trip is
    # what the test plan checks).
    LDFLAGS='-static -static-libgcc -static-libstdc++' \
      EXTRA_CFLAGS='-Os' \
      make -j\$(nproc) GZIP_SUPPORT=1 LZO_SUPPORT=0 LZMA_SUPPORT=0 \
                      LZ4_SUPPORT=1 XZ_SUPPORT=1 ZSTD_SUPPORT=1 \
                      XATTR_SUPPORT=0 mksquashfs >/tmp/build.log 2>&1 || {
        tail -100 /tmp/build.log
        exit 1
      }
    cp mksquashfs /out/mksquashfs
    strip /out/mksquashfs
  "

file "$OUT" || true
"$OUT" -version | head -2 || true
echo "Wrote $OUT"
