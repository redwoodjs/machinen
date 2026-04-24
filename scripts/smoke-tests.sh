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
#   V1-V4  Validation paths (no boot): host-missing, host-is-a-file,
#          guest-outside-/mnt/, second --mount.
#   T1     Base-only boot — `echo hello-world` reaches the host console.
#   T2     --mount exposes a host directory readable inside the guest.
#   T4     --env propagates into the guest process env — #89.
#   C1-C2  Host-side artifact cache end-to-end via fnm — #88.
#   P1-P3  Base-rootfs contract (criu, virtio modules, poweroff) — #77.
#   N1-N4  New #93 CLI surface: ls, exec, attach-unknown, completion.

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

# Note: the VMM no longer links libslirp (#82 — swapped for a gvproxy
# UDS). Networking is opt-in via MACHINEN_NET_SOCKET; the smoke tests
# below don't need it, so we don't gate on gvproxy here.

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

# Always rebuild. Zig's incremental cache makes this ~1s on a warm
# tree, and it guarantees local source edits are actually tested.
echo "=== building VMM ==="
(cd "$ROOT/packages/microvm" && zig build -Doptimize=ReleaseSafe)

# On darwin the VMM needs the hypervisor entitlement or HVF fails
# with HV_DENIED. Re-sign every time too — cheap, and the entitlement
# file may have changed out from under us.
if [[ "$OS" == "Darwin" ]]; then
  codesign -s - --force \
    --entitlements "$ROOT/packages/microvm/entitlements.plist" \
    "$VMM" 2>/dev/null
fi

if [[ ! -f "$ASSETS/Image-arm64" ]]; then
  echo "=== building base assets (~5 min on first run, cached after) ==="
  "$ROOT/scripts/build-base-assets.sh"
fi

if [[ ! -f "$CLI" ]]; then
  echo "=== building @machinen/runtime + @machinen/cli ==="
  pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null
fi

# Stage gvproxy next to the locally-built VMM so the runtime's
# sibling-lookup in resolveGvproxyBinary() finds it. Same script the
# release workflow runs (see .github/workflows/release.yml) — single
# source of truth for the pinned version.
"$ROOT/scripts/install-gvproxy.sh" --dest "$(dirname "$VMM")"

export MACHINEN_VMM="$VMM"
export MACHINEN_ASSETS_DIR="$ASSETS"

echo
echo "smoke: VMM=$MACHINEN_VMM"
echo "smoke: ASSETS=$MACHINEN_ASSETS_DIR"
echo

# Capability probe: N-series (vsock exec) and P/C-series (criu, vsock
# modules, fnm) need a #77+ rootfs. Peek inside the tarball for marker
# files; skip dependent sections with a warning if we're running
# against a stale (pre-#77) rootfs. Rebuild with
# ./scripts/build-base-assets.sh to pick them up.
ROOTFS_TAR="$ASSETS/rootfs-debian-arm64.tar.gz"
ROOTFS_SUPPORTS_VSOCK_EXEC=1
ROOTFS_SUPPORTS_CRIU=1
if ! tar tzf "$ROOTFS_TAR" 2>/dev/null | grep -q "vmw_vsock_virtio_transport"; then
  echo "smoke: WARN rootfs lacks vsock modules — N-series (vm.exec) will be skipped"
  ROOTFS_SUPPORTS_VSOCK_EXEC=0
fi
if ! tar tzf "$ROOTFS_TAR" 2>/dev/null | grep -q "usr/sbin/criu"; then
  echo "smoke: WARN rootfs lacks criu — P/C-series will be skipped"
  ROOTFS_SUPPORTS_CRIU=0
fi

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

# Run the CLI and assert it exits non-zero with `needle` on stderr.
# Used for validation paths that fail before any VMM boot, so no
# run_timeout wrapping is needed — they return immediately.
expect_cli_error() {
  local label=$1
  local needle=$2
  shift 2
  echo "$label"
  local out
  if out=$(node "$CLI" "$@" 2>&1); then
    echo "  FAIL: expected error '$needle', CLI exited 0 with:" >&2
    echo "$out" | head -20 >&2
    exit 1
  fi
  if grep -q -- "$needle" <<<"$out"; then
    pass "errored with '$needle'"
  else
    echo "  FAIL: expected '$needle' in output:" >&2
    echo "$out" | head -20 >&2
    exit 1
  fi
}

# ----------------------------------------------------------------
# Validation tests — no guest boot needed. Cheap, run first.
# ----------------------------------------------------------------

EMPTY_DIR="$FIXTURE/empty-dir"
mkdir -p "$EMPTY_DIR"
HOST_FILE="$FIXTURE/some-file.txt"
echo "just-a-file" >"$HOST_FILE"

expect_cli_error \
  "V1: --mount with missing host path" \
  "mount host path not found" \
  boot --mount "$FIXTURE/nope-does-not-exist:/mnt/x" -- true

expect_cli_error \
  "V2: --mount with a file instead of a directory" \
  "must be a directory" \
  boot --mount "$HOST_FILE:/mnt/f" -- true

expect_cli_error \
  "V3: --mount with guest path outside /mnt/" \
  "must live under /mnt/" \
  boot --mount "$EMPTY_DIR:/etc/passwd" -- true

expect_cli_error \
  "V4: second --mount rejected" \
  "at most once" \
  boot --mount "$EMPTY_DIR:/mnt/a" --mount "$EMPTY_DIR:/mnt/b" -- true

# ----------------------------------------------------------------
# Boot tests — need HVF/KVM. Slow.
# ----------------------------------------------------------------

# ---- T1: base-only spawn with echo ----
echo "T1: machinen boot -- echo hello-world"
T1_LOG="$FIXTURE/t1.log"
# Capture stdout + stderr: the guest's `echo` output arrives on the
# serial console, which the VMM writes to its stderr. The CLI pipes
# that to the host process's stderr; we redirect both into one log
# for grepping.
run_timeout 60 node "$CLI" boot -- echo "hello-world-$$" >"$T1_LOG" 2>&1 || true
if grep -q "hello-world-$$" "$T1_LOG"; then
  pass "base-only echo output visible on the host"
else
  tail -50 "$T1_LOG" >&2
  fail "T1 marker not found in guest output"
fi

# ---- T2: --mount exposes a host directory inside the guest ----
echo "T2: machinen boot --mount ./fixture:/mnt/data -- cat /mnt/data/hello.txt"
T2_MARKER="mount-marker-$$"
mkdir -p "$FIXTURE/data"
echo "$T2_MARKER" >"$FIXTURE/data/hello.txt"
T2_LOG="$FIXTURE/t2.log"
run_timeout 60 node "$CLI" boot \
  --mount "$FIXTURE/data:/mnt/data" \
  -- cat /mnt/data/hello.txt \
  >"$T2_LOG" 2>&1 || true
if grep -q "$T2_MARKER" "$T2_LOG"; then
  pass "mount contents readable inside guest"
else
  tail -50 "$T2_LOG" >&2
  fail "T2 marker ($T2_MARKER) not found in guest output"
fi

# ---- T4: --env propagates into the guest process env (#89) ----
echo "T4: machinen boot --env FOO=bar -- sh -c 'echo FOO=\$FOO'"
T4_MARKER="env-marker-$$"
T4_LOG="$FIXTURE/t4.log"
run_timeout 60 node "$CLI" boot \
  --env "FOO=$T4_MARKER" \
  -- /bin/sh -c 'echo FOO=$FOO' \
  >"$T4_LOG" 2>&1 || true
if grep -q "FOO=$T4_MARKER" "$T4_LOG"; then
  pass "--env value visible inside the guest"
else
  tail -50 "$T4_LOG" >&2
  fail "T4 marker (FOO=$T4_MARKER) not found in guest output"
fi

# ----------------------------------------------------------------
# Phase-1 base-rootfs contract tests — verify #77 step 1 plumbing.
# Each asserts one thing scripts/build-base-assets.sh claims to ship.
# ----------------------------------------------------------------

# ----------------------------------------------------------------
# #93 API surface — exercise the new CLI verbs end-to-end against a
# real guest. Uses a scratch registry dir so we don't pollute any
# real running VMs on the dev machine. Each test boots a named VM in
# the background, hits it with ls/exec, then kills it.
# ----------------------------------------------------------------

# Scratch registry for these tests. Redirects `boot()`'s writeEntry
# and `list()`/`attach()`'s lookups so we don't collide with the
# user's real ~/.machinen/vms entries.
export MACHINEN_REGISTRY_DIR="$FIXTURE/registry"
mkdir -p "$MACHINEN_REGISTRY_DIR"

# Helper: run a CLI subcommand (no run_timeout; they're all fast).
cli() {
  node "$CLI" "$@"
}

# Helper: boot a VM in the background under the given name. Writes
# its logs to the named path. Returns the background pid.
boot_bg() {
  local name=$1
  local log=$2
  shift 2
  node "$CLI" boot --name "$name" "$@" >"$log" 2>&1 &
  echo $!
}

# Helper: wait for a named VM to appear in `machinen ls`, up to 30s.
wait_for_vm() {
  local name=$1
  local deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$name"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ---- N1: machinen ls shows nothing when the registry is empty ----
echo "N1: machinen ls against an empty registry"
N1_LOG="$FIXTURE/n1.log"
cli ls >"$N1_LOG" 2>&1 || true
if grep -q "no running VMs" "$N1_LOG"; then
  pass "ls reports '(no running VMs)' when registry is empty"
else
  cat "$N1_LOG" >&2
  fail "N1 — expected '(no running VMs)'"
fi

# ---- N2: boot --name + ls + exec round-trip ----
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 ]]; then
  echo "N2: skipped (rootfs lacks vsock modules)"
else
echo "N2: machinen boot --name worker; ls; exec; kill"
N2_NAME="smoke-worker-$$"
N2_LOG="$FIXTURE/n2.log"
N2_BG_LOG="$FIXTURE/n2-bg.log"
# Start /exec-agent in the background so `machinen exec` has something
# to talk to on vsock port 1978, then keep the VM alive with sleep.
# The guest /init doesn't auto-launch exec-agent — it's opt-in per
# workload.
N2_PID=$(boot_bg "$N2_NAME" "$N2_BG_LOG" -- /bin/sh -c "/exec-agent & sleep 120")
cleanup_n2() { kill -TERM "$N2_PID" 2>/dev/null || true; wait "$N2_PID" 2>/dev/null || true; }
trap 'cleanup_n2; rm -rf "$FIXTURE"' EXIT

if wait_for_vm "$N2_NAME"; then
  pass "boot --name registered '$N2_NAME' in the VM registry"
else
  tail -50 "$N2_BG_LOG" >&2
  fail "N2 — '$N2_NAME' never appeared in 'machinen ls'"
fi

# machinen ls output should have a header + the worker row.
cli ls >"$N2_LOG" 2>&1 || true
if grep -q "$N2_NAME" "$N2_LOG"; then
  pass "'machinen ls' lists '$N2_NAME'"
else
  cat "$N2_LOG" >&2
  fail "N2 — 'machinen ls' missing '$N2_NAME'"
fi

# machinen exec <name> -- uname -m should return 0 + aarch64.
N2_EXEC_LOG="$FIXTURE/n2-exec.log"
if cli exec "$N2_NAME" -- uname -m >"$N2_EXEC_LOG" 2>&1; then
  if grep -qE "aarch64|arm64" "$N2_EXEC_LOG"; then
    pass "'machinen exec $N2_NAME -- uname -m' returned aarch64"
  else
    cat "$N2_EXEC_LOG" >&2
    fail "N2 — exec stdout missing arch marker"
  fi
else
  cat "$N2_EXEC_LOG" >&2
  fail "N2 — 'machinen exec' exited non-zero"
fi

cleanup_n2
trap 'rm -rf "$FIXTURE"' EXIT
fi  # N2 rootfs-capability gate

# ---- N3: machinen attach <unknown> errors cleanly ----
echo "N3: machinen attach against an unknown name"
N3_LOG="$FIXTURE/n3.log"
if cli attach "nope-does-not-exist-$$" >"$N3_LOG" 2>&1; then
  cat "$N3_LOG" >&2
  fail "N3 — attach to unknown name should have failed"
fi
if grep -q "no running VM found" "$N3_LOG"; then
  pass "attach surfaces 'no running VM found' for missing names"
else
  cat "$N3_LOG" >&2
  fail "N3 — expected 'no running VM found' in error output"
fi

# ---- N4: machinen completion emits a shell snippet ----
echo "N4: machinen completion bash|zsh|fish"
for shell in bash zsh fish; do
  out=$(cli completion "$shell" 2>&1 || true)
  if [[ -z "$out" ]]; then
    fail "N4 — completion $shell produced no output"
  fi
  if grep -q "machinen" <<<"$out"; then
    pass "completion $shell emitted a script"
  else
    echo "$out" | head -5 >&2
    fail "N4 — completion $shell output didn't mention 'machinen'"
  fi
done

if [[ "$ROOTFS_SUPPORTS_CRIU" -eq 0 ]]; then
  echo
  echo "smoke: P/C-series skipped (stale rootfs — rebuild with scripts/build-base-assets.sh)"
  echo "all smoke tests passed (with skips — see warnings above)"
  exit 0
fi

# ---- P1: criu binary present and usable ----
# Absolute path — the CLI wraps non-absolute cmds in `/usr/bin/env`,
# which does its own PATH search that doesn't know about /sbin by
# default. Using /usr/sbin/criu directly bypasses that and tests
# exactly what phase 1 shipped.
echo "P1: machinen boot -- /usr/sbin/criu --version"
P1_LOG="$FIXTURE/p1.log"
run_timeout 60 node "$CLI" boot -- /usr/sbin/criu --version >"$P1_LOG" 2>&1 || true
if grep -q "^Version:" "$P1_LOG"; then
  pass "criu runs inside the base rootfs"
else
  tail -50 "$P1_LOG" >&2
  fail "P1 — criu --version did not print a Version: line"
fi

# ---- P2: virtio_blk + vmw_vsock_virtio_transport modprobed at boot ----
# /init's loadPlumbingModules() runs before exec'ing the user cmd, so
# /proc/modules should list both. Reading /proc directly avoids
# depending on lsmod's PATH location.
echo "P2: machinen boot -- cat /proc/modules (virtio_blk + vmw_vsock_virtio_transport)"
P2_LOG="$FIXTURE/p2.log"
run_timeout 60 node "$CLI" boot -- /bin/cat /proc/modules >"$P2_LOG" 2>&1 || true
if grep -qE "^virtio_blk " "$P2_LOG" && grep -qE "^vmw_vsock_virtio_transport " "$P2_LOG"; then
  pass "init loaded virtio_blk + vmw_vsock_virtio_transport"
else
  tail -50 "$P2_LOG" >&2
  fail "P2 — expected virtio_blk and vmw_vsock_virtio_transport in /proc/modules"
fi

# ---- P3: machinen-poweroff triggers PSCI SYSTEM_OFF, VMM exits cleanly ----
# The normal exit path (init exits → kernel panic → panic reboot) can
# look the same to an outside observer. We specifically want to prove
# the /sbin/machinen-poweroff helper works: the kernel prints
# "reboot: Power down" only on a real POWER_OFF syscall.
echo "P3: machinen boot -- /sbin/machinen-poweroff"
P3_LOG="$FIXTURE/p3.log"
run_timeout 60 node "$CLI" boot -- /sbin/machinen-poweroff >"$P3_LOG" 2>&1 || true
if grep -q "reboot: Power down" "$P3_LOG"; then
  pass "machinen-poweroff invoked reboot(POWER_OFF)"
else
  tail -50 "$P3_LOG" >&2
  fail "P3 — kernel never reported 'reboot: Power down'"
fi

# ----------------------------------------------------------------
# #88 artifact-cache tests — verify the host-side node-dist mirror
# end-to-end. spawn() starts the cache, injects FNM_NODE_DIST_MIRROR
# into the guest env via #89's guestEnv plumbing, and fnm inside the
# guest pulls through it.
# ----------------------------------------------------------------

FNM_TEST_NODE="22"

# fnm shells out and requires PATH in its env. init doesn't set one
# by default (it only backfills TERM), so pass one through --env.
GUEST_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# ---- C1: cold `fnm install` populates the host-side cache ----
echo "C1: cold fnm install $FNM_TEST_NODE populates host cache"
C1_CACHE="$FIXTURE/cache-c1"
C1_LOG="$FIXTURE/c1.log"
mkdir -p "$C1_CACHE"
MACHINEN_CACHE_DIR="$C1_CACHE" \
  run_timeout 180 node "$CLI" boot --env "PATH=$GUEST_PATH" -- \
    /bin/sh -c "fnm install $FNM_TEST_NODE && fnm exec --using=$FNM_TEST_NODE node -v" \
    >"$C1_LOG" 2>&1 || true
if grep -qE "^v${FNM_TEST_NODE}\." "$C1_LOG"; then
  pass "fnm install + node -v reported v${FNM_TEST_NODE}.*"
else
  tail -80 "$C1_LOG" >&2
  fail "C1 — expected a v${FNM_TEST_NODE}.* line in guest output"
fi
# Tarball filename shape matches fnm's layout:
# node-dist/vX.Y.Z/node-vX.Y.Z-linux-arm64.tar.xz.
if find "$C1_CACHE/node-dist" -name "node-v${FNM_TEST_NODE}.*-linux-arm64.tar.*" 2>/dev/null | grep -q .; then
  pass "cache populated under $C1_CACHE/node-dist/"
else
  ls -R "$C1_CACHE" >&2 || true
  fail "C1 — expected a node-v${FNM_TEST_NODE}.* tarball under cache dir"
fi

# ---- C2: warm `fnm install` served entirely from the on-disk cache ----
# Second boot reuses the C1 cache dir. Upstream pointed at a refused
# port — if anything reaches through the cache, the install fails.
echo "C2: warm fnm install $FNM_TEST_NODE serves from cache (no upstream)"
C2_LOG="$FIXTURE/c2.log"
MACHINEN_CACHE_DIR="$C1_CACHE" \
MACHINEN_NODE_DIST_UPSTREAM="http://127.0.0.1:1" \
  run_timeout 180 node "$CLI" boot --env "PATH=$GUEST_PATH" -- \
    /bin/sh -c "fnm install $FNM_TEST_NODE && fnm exec --using=$FNM_TEST_NODE node -v" \
    >"$C2_LOG" 2>&1 || true
if grep -qE "^v${FNM_TEST_NODE}\." "$C2_LOG"; then
  pass "warm install worked with upstream pointed at a dead port"
else
  tail -80 "$C2_LOG" >&2
  fail "C2 — warm install failed; cache is not being read"
fi


echo
echo "all smoke tests passed"
