#!/usr/bin/env bash
# Build the static guest-side binaries (init + exec-agent + vsock
# agents) from their .zig sources. Cross-compiled for aarch64-linux-musl
# so they run on any arm64 guest rootfs regardless of its libc.
#
# Run from packages/microvm:
#   test-fixtures/assets/build-init.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")/../.." && pwd)
cd "$HERE"

build() {
    local name=$1
    zig build-exe "assets/${name}.zig" \
        -target aarch64-linux-musl \
        -O ReleaseSmall \
        -lc \
        -femit-bin="test-fixtures/${name}"
    rm -f "test-fixtures/${name}.o"
    echo "built test-fixtures/${name} ($(wc -c < "test-fixtures/${name}") bytes)"
}

build init
build exec-agent
build file-agent
build fuse-agent
build secrets-agent
build winsize-agent
