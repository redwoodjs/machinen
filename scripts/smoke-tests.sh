#!/usr/bin/env bash
# End-to-end smoke tests for the machinen CLI.
#
# Local-only: boots a real guest and asserts on its output. GitHub-
# hosted runners (macOS and Linux) don't expose nested virtualization,
# so this can't run in hosted CI. Requires an Apple Silicon Mac with
# HVF or a Linux machine with /dev/kvm.
#
# Invoke via `pnpm smoke-tests` from the repo root.
#
# Tests:
#   T1  Base-only spawn — `echo hello-world` reaches the host console.
#   T2  --mount exposes a host directory readable inside the guest.
#   T3  Bundle wins on a /mnt/ collision — layering smoke.
#
# Inputs (auto-discovered if unset):
#   MACHINEN_VMM           Path to the built + codesigned VMM binary.
#                          Default: packages/microvm/zig-out/bin/microvm
#   MACHINEN_ASSETS_DIR    Directory with Image-arm64, virt-arm64.dtb,
#                          rootfs-debian-arm64.tar.gz.
#                          Default: ./release-assets
#
# If either is missing, this script prints the command to produce it
# and exits non-zero.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"

# Auto-discover the VMM binary in the local build output if the caller
# didn't set MACHINEN_VMM explicitly.
if [[ -z "${MACHINEN_VMM:-}" ]]; then
  default_vmm="$ROOT/packages/microvm/zig-out/bin/microvm"
  if [[ -x "$default_vmm" ]]; then
    MACHINEN_VMM="$default_vmm"
  else
    cat >&2 <<EOF
smoke: MACHINEN_VMM not set and no local build at $default_vmm

Build it first:
  (cd packages/microvm && zig build -Doptimize=ReleaseSafe)
  codesign -s - --force \\
    --entitlements packages/microvm/entitlements.plist \\
    packages/microvm/zig-out/bin/microvm
EOF
    exit 1
  fi
fi

# Auto-discover base assets if MACHINEN_ASSETS_DIR isn't set.
if [[ -z "${MACHINEN_ASSETS_DIR:-}" ]]; then
  default_assets="$ROOT/release-assets"
  if [[ -f "$default_assets/Image-arm64" ]]; then
    MACHINEN_ASSETS_DIR="$default_assets"
  else
    cat >&2 <<EOF
smoke: MACHINEN_ASSETS_DIR not set and no local assets at $default_assets

Build them first (needs Docker running):
  ./scripts/build-base-assets.sh
EOF
    exit 1
  fi
fi

# Auto-build the TS CLI if the dist bundle is missing. Cheap (~1s).
if [[ ! -f "$CLI" ]]; then
  echo "smoke: building @machinen/cli..."
  pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null
fi

[[ -x "$MACHINEN_VMM" ]] || {
  echo "smoke: MACHINEN_VMM is not executable: $MACHINEN_VMM" >&2
  exit 1
}
command -v gtimeout >/dev/null || {
  echo "smoke: gtimeout not on PATH (brew install coreutils)" >&2
  exit 1
}

export MACHINEN_VMM MACHINEN_ASSETS_DIR

echo "smoke: VMM=$MACHINEN_VMM"
echo "smoke: ASSETS=$MACHINEN_ASSETS_DIR"
echo

FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

# Wall-clock ceiling per test. Each guest boots from scratch (no
# snapshot yet), and a cold kernel + rootfs startup is ~5-10s; 60s
# gives plenty of headroom. `gtimeout -s TERM` lets the CLI's SIGTERM
# handler kill the VMM cleanly instead of leaving an orphan.
TIMEOUT="gtimeout -s TERM 60"

pass() { echo "  pass: $1"; }
fail() { echo "  FAIL: $1" >&2; exit 1; }

# ----------------------------------------------------------------
# T1 — base-only spawn with echo
# ----------------------------------------------------------------
echo "T1: machinen run -- echo hello-world"
T1_LOG="$FIXTURE/t1.log"
# Capture stdout + stderr: the guest's `echo` output arrives on the
# serial console, which the VMM writes to its stderr. The CLI pipes
# that to the host process's stderr; we redirect both streams into
# one log for grepping.
$TIMEOUT node "$CLI" run -- echo "hello-world-$$" >"$T1_LOG" 2>&1 || true
if grep -q "hello-world-$$" "$T1_LOG"; then
  pass "base-only echo output visible on the host"
else
  tail -50 "$T1_LOG" >&2
  fail "T1 marker not found in guest output"
fi

# ----------------------------------------------------------------
# T2 — --mount exposes a host directory inside the guest
# ----------------------------------------------------------------
echo "T2: machinen run --mount ./fixture:/mnt/data -- cat /mnt/data/hello.txt"
T2_MARKER="mount-marker-$$"
mkdir -p "$FIXTURE/data"
echo "$T2_MARKER" > "$FIXTURE/data/hello.txt"
T2_LOG="$FIXTURE/t2.log"
$TIMEOUT node "$CLI" run \
  --mount "$FIXTURE/data:/mnt/data" \
  -- cat /mnt/data/hello.txt \
  >"$T2_LOG" 2>&1 || true
if grep -q "$T2_MARKER" "$T2_LOG"; then
  pass "mount contents readable inside guest"
else
  tail -50 "$T2_LOG" >&2
  fail "T2 marker ($T2_MARKER) not found in guest output"
fi

# ----------------------------------------------------------------
# T3 — bundle wins on a /mnt/ path collision
# ----------------------------------------------------------------
#
# Build a tiny bundle whose rootfs ships /mnt/collide/x.txt with a
# known marker. Then run it with a --mount that would place a
# different marker at the same path. The layering rule says the
# bundle wins, so the guest should see the bundle's version.
echo "T3: bundle wins on collision under /mnt/"
T3_BUNDLE_MARKER="bundle-wins-$$"
T3_MOUNT_MARKER="mount-loses-$$"
T3_BUNDLE="$FIXTURE/bundle"
mkdir -p "$T3_BUNDLE/rootfs/mnt/collide"
echo "$T3_BUNDLE_MARKER" > "$T3_BUNDLE/rootfs/mnt/collide/x.txt"
cat > "$T3_BUNDLE/machinen-config.json" <<JSON
{ "cmd": ["/bin/cat", "/mnt/collide/x.txt"] }
JSON
mkdir -p "$FIXTURE/alt"
echo "$T3_MOUNT_MARKER" > "$FIXTURE/alt/x.txt"
T3_LOG="$FIXTURE/t3.log"
$TIMEOUT node "$CLI" run "$T3_BUNDLE" \
  --mount "$FIXTURE/alt:/mnt/collide" \
  >"$T3_LOG" 2>&1 || true
if grep -q "$T3_BUNDLE_MARKER" "$T3_LOG" && ! grep -q "$T3_MOUNT_MARKER" "$T3_LOG"; then
  pass "bundle content wins on /mnt/ collision"
else
  tail -50 "$T3_LOG" >&2
  fail "T3 expected $T3_BUNDLE_MARKER (not $T3_MOUNT_MARKER) in guest output"
fi

echo
echo "all smoke tests passed"
