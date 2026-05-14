#!/usr/bin/env bash
# Build a static mke2fs for arm64 linux and drop it at bin/mke2fs.
#
# Why: Homebrew's e2fsprogs is keg-only on macOS, and Linux installs
# vary in path. Bundling a known-good static binary lets the runtime
# materialize ext4 rootfs images without any host install.
#
# Why static + musl + Alpine: musl can be linked statically (glibc
# can't, in practice), so the resulting binary runs on every Linux
# arm64 distribution regardless of libc. Alpine is the smallest
# environment that ships the necessary build tools.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$PKG_DIR/bin/mke2fs"
E2FS_VERSION="${E2FS_VERSION:-1.47.0}"

mkdir -p "$PKG_DIR/bin"

docker run --rm --platform=linux/arm64 \
  -v "$PKG_DIR/bin":/out \
  alpine:3.20 sh -eu -c "
    apk add --no-cache build-base linux-headers wget >/dev/null
    cd /tmp
    wget -q https://kernel.org/pub/linux/kernel/people/tytso/e2fsprogs/v${E2FS_VERSION}/e2fsprogs-${E2FS_VERSION}.tar.gz
    tar xf e2fsprogs-${E2FS_VERSION}.tar.gz
    cd e2fsprogs-${E2FS_VERSION}
    LDFLAGS='-static -static-libgcc' ./configure \
      --disable-nls --disable-tdb --disable-fuse2fs \
      --disable-uuidd --disable-fsck >/dev/null
    make -j\$(nproc) >/dev/null
    cp misc/mke2fs /out/mke2fs
    strip /out/mke2fs
  "

file "$OUT" || true
"$OUT" -V
echo "Wrote $OUT"
