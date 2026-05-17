#!/usr/bin/env bash
# Build a static mksquashfs for x64 linux and drop it at bin/mksquashfs.
#
# Static musl/Alpine build so the result runs on any Linux x64 distro
# regardless of the host libc.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$PKG_DIR/bin/mksquashfs"
SQUASHFS_VERSION="${SQUASHFS_VERSION:-4.7.5}"

mkdir -p "$PKG_DIR/bin"

docker run --rm --platform=linux/amd64 \
  -v "$PKG_DIR/bin":/out \
  alpine:3.20 sh -eu -c "
    apk add --no-cache build-base linux-headers wget zstd-dev zstd-static \
                       lz4-dev lz4-static xz-dev xz-static \
                       zlib-dev zlib-static >/dev/null
    cd /tmp
    wget -q https://github.com/plougher/squashfs-tools/archive/refs/tags/${SQUASHFS_VERSION}.tar.gz -O sq.tar.gz
    tar xf sq.tar.gz
    cd squashfs-tools-${SQUASHFS_VERSION}/squashfs-tools
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
