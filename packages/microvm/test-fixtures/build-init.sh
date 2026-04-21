#!/usr/bin/env bash
# Build test-fixtures/init from init.zig. Static aarch64-linux-musl
# so it runs under any arm64 rootfs regardless of its libc.
#
# Run from packages/microvm:
#   test-fixtures/build-init.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
zig build-exe test-fixtures/init.zig \
    -target aarch64-linux-musl \
    -O ReleaseSmall \
    -lc \
    -femit-bin=test-fixtures/init
rm -f test-fixtures/init.o
echo "built test-fixtures/init ($(wc -c < test-fixtures/init) bytes)"
