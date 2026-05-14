#!/usr/bin/env bash
# Build the host-side mount-server binary (#329) for every supported
# host target and stage each one where the runtime resolves it.
# Mirrors scripts/build-vmm.sh but produces two binaries from one Zig
# source — Zig cross-compiles to aarch64-linux-gnu trivially, so this
# runs from any host (no remote builder needed).
#
# Targets:
#   - aarch64-macos  → packages/mount-server-arm64-darwin/bin/
#   - aarch64-linux-gnu → packages/mount-server-arm64-linux/bin/
#
# Each gets an inputs-sha256 sidecar that check-asset-freshness.sh
# consumes.
#
# Usage:
#   bash scripts/build-mount-server.sh

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PKG="$ROOT/packages/mount-server"

build_one() {
  local zig_target="$1"
  local dest_pkg="$2"
  local label="$3"

  echo "==> building mount-server ($label, zig ReleaseFast)"
  ( cd "$PKG" && zig build -Dtarget="$zig_target" -Doptimize=ReleaseFast )

  local dest_dir="$ROOT/packages/$dest_pkg/bin"
  local dest="$dest_dir/machinen-mount-server"
  local sidecar="$dest.inputs-sha256"

  echo "==> staging $label into $dest"
  mkdir -p "$dest_dir"
  cp "$PKG/zig-out/bin/machinen-mount-server" "$dest"

  echo "==> writing $label inputs sidecar"
  mount_server_input_files | compute_sha > "$sidecar"
}

# shellcheck source=./check-asset-freshness.sh
source "$ROOT/scripts/check-asset-freshness.sh"

build_one "aarch64-macos"     "mount-server-arm64-darwin" "darwin-arm64"
build_one "aarch64-linux-gnu" "mount-server-arm64-linux"  "linux-arm64"

echo "==> Done."
