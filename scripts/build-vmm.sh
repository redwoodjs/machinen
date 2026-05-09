#!/usr/bin/env bash
# Build the host-side VMM binary (the per-guest hypervisor process)
# and stage it where the runtime resolves it. Mirrors what
# build-base-assets.sh does for the rootfs + kernel: produces the
# artifact, then writes an inputs-sha256 sidecar that
# check-asset-freshness.sh consumes.
#
# Why this script exists separately from build-base-assets.sh: the VMM
# inputs (packages/microvm/src/*.zig + build.zig + entitlements) are
# disjoint from the in-guest assets, and rebuilding the VMM is cheap
# (zig's incremental cache, ~1s on a warm tree) — so we run it on
# every freshness fail rather than bundling it into the slow
# rootfs/kernel rebuild.
#
# Usage:
#   bash scripts/build-vmm.sh

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PKG="$ROOT/packages/microvm"
DEST_DIR="$ROOT/packages/vmm-arm64-darwin/bin"
DEST="$DEST_DIR/machinen-vm"
SIDECAR="$DEST.inputs-sha256"
OS=$(uname -s)

echo "==> building VMM (zig ReleaseSafe)"
( cd "$PKG" && zig build -Doptimize=ReleaseSafe )

# HVF needs the hypervisor entitlement on darwin or `boot` fails with
# HV_DENIED. Re-sign every build because entitlements.plist may have
# changed and codesign is fast.
if [[ "$OS" == "Darwin" ]]; then
  echo "==> codesigning with HVF entitlement"
  codesign -s - --force \
    --entitlements "$PKG/entitlements.plist" \
    "$PKG/zig-out/bin/machinen-vm"
fi

echo "==> staging into $DEST"
mkdir -p "$DEST_DIR"
cp "$PKG/zig-out/bin/machinen-vm" "$DEST"

# Sidecar consumed by scripts/check-asset-freshness.sh. Source the
# checker so the input list (`vmm_input_files`) lives in one place —
# drift between "what we hash here" and "what the checker hashes"
# would defeat the staleness probe.
echo "==> writing inputs sidecar"
# shellcheck source=./check-asset-freshness.sh
source "$ROOT/scripts/check-asset-freshness.sh"
vmm_input_files | compute_sha > "$SIDECAR"

echo "    sidecar: $SIDECAR"
echo "==> Done."
