#!/usr/bin/env bash
# End-to-end smoke tests for the machinen CLI. Local-only — GitHub-
# hosted runners don't expose nested virtualization, so this can't
# run in hosted CI. See the commit history for details.
#
# Invoke via `pnpm smoke-tests` from the repo root.
#
# This script is self-sufficient: it builds anything it needs that
# isn't already built, then runs the tests.
#   - @machinen/runtime + @machinen/cli  (fast)
#   - packages/microvm/zig-out/bin/microvm  (~30s on first run)
#   - release-assets/ (Image, dtb, rootfs tarball)  (~5 min, needs Docker)
#
# Tests:
#   T1  Base-only spawn — `echo hello-world` reaches the host console.
#   T2  --mount exposes a host directory readable inside the guest.
#   T3  Bundle wins on a /mnt/ collision — layering smoke.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"
VMM="$ROOT/packages/microvm/zig-out/bin/microvm"
ASSETS="$ROOT/release-assets"
OS=$(uname -s)

# ----------------------------------------------------------------
# Prereq checks
# ----------------------------------------------------------------

missing=()
for bin in zig docker dtc; do
  command -v "$bin" >/dev/null || missing+=("$bin")
done

# libslirp is a dylib the VMM links against at runtime, not a binary.
# Check the common Homebrew locations.
if [[ "$OS" == "Darwin" ]]; then
  found=0
  for p in /opt/homebrew/opt/libslirp/lib/libslirp.0.dylib \
    /usr/local/opt/libslirp/lib/libslirp.0.dylib; do
    [[ -f "$p" ]] && {
      found=1
      break
    }
  done
  [[ "$found" -eq 1 ]] || missing+=("libslirp")
fi

if ((${#missing[@]} > 0)); then
  echo "smoke: missing prerequisites: ${missing[*]}" >&2
  if [[ "$OS" == "Darwin" ]]; then
    # Map names → brew formulae (all happen to match today).
    echo "smoke: install with: brew install ${missing[*]}" >&2
  fi
  exit 1
fi

# Docker needs to be running, but only if we still have to build the
# base assets. A warm repo with release-assets/ already present should
# not require Docker Desktop at all.
if [[ ! -f "$ASSETS/Image-arm64" ]]; then
  if ! docker info >/dev/null 2>&1; then
    echo "smoke: Docker is not running (needed to build release-assets/)" >&2
    echo "smoke: start Docker Desktop and re-run" >&2
    exit 1
  fi
fi

# ----------------------------------------------------------------
# Build what's missing
# ----------------------------------------------------------------

if [[ ! -x "$VMM" ]]; then
  echo "=== building VMM (~30s on first run) ==="
  (cd "$ROOT/packages/microvm" && zig build -Doptimize=ReleaseSafe)
fi

# On darwin the VMM needs the hypervisor entitlement or HVF fails
# with HV_DENIED. Ad-hoc codesigning is cheap; re-sign if the current
# binary doesn't carry the entitlement.
if [[ "$OS" == "Darwin" ]]; then
  if ! codesign -d --entitlements :- "$VMM" 2>/dev/null |
    grep -q "com.apple.vm.hypervisor\|com.apple.security.hypervisor"; then
    echo "=== codesigning VMM with hypervisor entitlement ==="
    codesign -s - --force \
      --entitlements "$ROOT/packages/microvm/entitlements.plist" \
      "$VMM" 2>/dev/null
  fi
fi

if [[ ! -f "$ASSETS/Image-arm64" ]]; then
  echo "=== building base assets (~5 min on first run, cached after) ==="
  "$ROOT/scripts/build-base-assets.sh"
fi

if [[ ! -f "$CLI" ]]; then
  echo "=== building @machinen/runtime + @machinen/cli ==="
  pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null
fi

export MACHINEN_VMM="$VMM"
export MACHINEN_ASSETS_DIR="$ASSETS"

echo
echo "smoke: VMM=$MACHINEN_VMM"
echo "smoke: ASSETS=$MACHINEN_ASSETS_DIR"
echo

# ----------------------------------------------------------------
# Tests
# ----------------------------------------------------------------

FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

# Wall-clock ceiling per test. Cold kernel + rootfs startup is ~5-10s;
# 60s is generous. Sends SIGTERM first (so the CLI's signal handler
# can kill the VMM cleanly), escalates to SIGKILL after a 2s grace.
# Rolled by hand because macOS BSD doesn't ship a `timeout` binary.
run_timeout() {
  local secs=$1
  shift
  "$@" &
  local pid=$!
  (sleep "$secs" && kill -TERM "$pid" 2>/dev/null && sleep 2 && kill -KILL "$pid" 2>/dev/null) &
  local watcher=$!
  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return "$rc"
}

pass() { echo "  pass: $1"; }
fail() { echo "  FAIL: $1" >&2; exit 1; }

# ---- T1: base-only spawn with echo ----
echo "T1: machinen run -- echo hello-world"
T1_LOG="$FIXTURE/t1.log"
# Capture stdout + stderr: the guest's `echo` output arrives on the
# serial console, which the VMM writes to its stderr. The CLI pipes
# that to the host process's stderr; we redirect both into one log
# for grepping.
run_timeout 60 node "$CLI" run -- echo "hello-world-$$" >"$T1_LOG" 2>&1 || true
if grep -q "hello-world-$$" "$T1_LOG"; then
  pass "base-only echo output visible on the host"
else
  tail -50 "$T1_LOG" >&2
  fail "T1 marker not found in guest output"
fi

# ---- T2: --mount exposes a host directory inside the guest ----
echo "T2: machinen run --mount ./fixture:/mnt/data -- cat /mnt/data/hello.txt"
T2_MARKER="mount-marker-$$"
mkdir -p "$FIXTURE/data"
echo "$T2_MARKER" >"$FIXTURE/data/hello.txt"
T2_LOG="$FIXTURE/t2.log"
run_timeout 60 node "$CLI" run \
  --mount "$FIXTURE/data:/mnt/data" \
  -- cat /mnt/data/hello.txt \
  >"$T2_LOG" 2>&1 || true
if grep -q "$T2_MARKER" "$T2_LOG"; then
  pass "mount contents readable inside guest"
else
  tail -50 "$T2_LOG" >&2
  fail "T2 marker ($T2_MARKER) not found in guest output"
fi

# ---- T3: bundle wins on a /mnt/ path collision ----
echo "T3: bundle wins on collision under /mnt/"
T3_BUNDLE_MARKER="bundle-wins-$$"
T3_MOUNT_MARKER="mount-loses-$$"
T3_BUNDLE="$FIXTURE/bundle"
mkdir -p "$T3_BUNDLE/rootfs/mnt/collide"
echo "$T3_BUNDLE_MARKER" >"$T3_BUNDLE/rootfs/mnt/collide/x.txt"
cat >"$T3_BUNDLE/machinen-config.json" <<JSON
{ "cmd": ["/bin/cat", "/mnt/collide/x.txt"] }
JSON
mkdir -p "$FIXTURE/alt"
echo "$T3_MOUNT_MARKER" >"$FIXTURE/alt/x.txt"
T3_LOG="$FIXTURE/t3.log"
run_timeout 60 node "$CLI" run "$T3_BUNDLE" \
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
