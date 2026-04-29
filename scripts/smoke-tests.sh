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
#   V5-V8  --mount-live validation, including :ro / :rw modes — #78, #151.
#   T1     Base-only boot — `echo hello-world` reaches the host console.
#   T2     --mount exposes a host directory readable inside the guest.
#   T3     --mount-live :ro streams a host file in lazily — #78.
#   T4     --env propagates into the guest process env — #89.
#   T5     --mount-live (default :rw) guest writes land on the host — #151, #156.
#   C1-C2  Host-side artifact cache end-to-end via fnm — #88.
#   P1-P3  Base-rootfs contract (criu, virtio modules, poweroff) — #77.
#   N1-N5  New #93 CLI surface: ls, exec, attach-unknown, completion,
#          plus image-carries-cmd default.

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

# Networking is opt-in via MACHINEN_NET_SOCKET (gvproxy UDS). The
# smoke tests below don't need it, so we don't gate on gvproxy here.

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
ROOTFS_SUPPORTS_SNAPSHOT_HELPERS=1
if ! tar tzf "$ROOTFS_TAR" 2>/dev/null | grep -q "vmw_vsock_virtio_transport"; then
  echo "smoke: WARN rootfs lacks vsock modules — N-series (vm.exec) will be skipped"
  ROOTFS_SUPPORTS_VSOCK_EXEC=0
fi
if ! tar tzf "$ROOTFS_TAR" 2>/dev/null | grep -q "usr/sbin/criu"; then
  echo "smoke: WARN rootfs lacks criu — P/C-series will be skipped"
  ROOTFS_SUPPORTS_CRIU=0
fi
if ! tar tzf "$ROOTFS_TAR" 2>/dev/null | grep -q "sbin/machinen-dump"; then
  echo "smoke: WARN rootfs lacks /sbin/machinen-dump — S-series (snapshot) will be skipped"
  ROOTFS_SUPPORTS_SNAPSHOT_HELPERS=0
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

# --- #78 live-share mount (--mount-live) validation paths ---------

expect_cli_error \
  "V5: --mount-live with missing host path" \
  "liveMounts\[0\] host path not found" \
  boot --mount-live "$FIXTURE/nope-does-not-exist:/mnt/x" -- true

expect_cli_error \
  "V6: --mount-live with a file instead of a directory" \
  "must be a directory" \
  boot --mount-live "$HOST_FILE:/mnt/f" -- true

expect_cli_error \
  "V7: --mount-live with guest path outside /mnt/" \
  "must live under /mnt/" \
  boot --mount-live "$EMPTY_DIR:/etc/passwd" -- true

expect_cli_error \
  "V8: --mount-live rejects an unknown mode" \
  "mode must be 'ro' or 'rw'" \
  boot --mount-live "$EMPTY_DIR:/mnt/x:xx" -- true

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

# ---- T3: --mount-live streams a file through the FUSE relay (#78) ----
#
# Unlike T2 (copy-once), the host file must land in the guest lazily
# via the vsock FUSE server, NOT be baked into the boot cpio. We
# write the marker after the VM starts to prove that.
#
# Skips if the current base kernel doesn't carry fuse.ko yet. That
# whitelist change is in scripts/build-base-assets.sh on this branch
# but the cached release-assets/ rootfs tarball may predate it.
echo "T3: machinen boot --mount-live ./fixture:/mnt/live:ro -- cat /mnt/live/hello.txt"
if ! tar -tzf "$ROOTFS_TAR" 2>/dev/null | grep -q 'fuse\.ko'; then
  echo "  skip: fuse.ko not in $ROOTFS_TAR — rebuild base assets"
else
  T3_MARKER="livemount-marker-$$"
  T3_SRC="$FIXTURE/live-src"
  T3_LOG="$FIXTURE/t3.log"
  mkdir -p "$T3_SRC"
  # Seed the marker file AFTER the VM is already running to prove the
  # read streamed in through vsock (copy-once would have cached an
  # empty dir at boot).
  (
    sleep 3
    echo "$T3_MARKER" >"$T3_SRC/hello.txt"
  ) &
  SEEDER=$!
  # Explicit `:ro` since the default is `:rw` (#156); this test
  # intentionally exercises the read-only path.
  run_timeout 60 node "$CLI" boot \
    --mount-live "$T3_SRC:/mnt/live:ro" \
    -- /bin/sh -c 'sleep 4 && cat /mnt/live/hello.txt' \
    >"$T3_LOG" 2>&1 || true
  wait "$SEEDER" 2>/dev/null || true
  if grep -q "$T3_MARKER" "$T3_LOG"; then
    pass "live-mount streamed a file written after boot"
  else
    tail -80 "$T3_LOG" >&2
    fail "T3 marker ($T3_MARKER) not found — live mount didn't stream through"
  fi
fi

# ---- T5: --mount-live :rw writes from inside the guest land on the host (#151) ----
#
# Boots with `--mount-live <dir>:/mnt/live` (default :rw post-#156),
# has the guest echo a marker into a file under that mount, then
# asserts the file appears on the host filesystem with the right
# contents AFTER the VM exits. Same fuse.ko gate as T3.
echo "T5: machinen boot --mount-live (default :rw) — guest write reaches the host"
if ! tar -tzf "$ROOTFS_TAR" 2>/dev/null | grep -q 'fuse\.ko'; then
  echo "  skip: fuse.ko not in $ROOTFS_TAR — rebuild base assets"
else
  T5_MARKER="livemount-rw-marker-$$"
  T5_SRC="$FIXTURE/live-rw"
  T5_LOG="$FIXTURE/t5.log"
  mkdir -p "$T5_SRC"
  run_timeout 60 node "$CLI" boot \
    --mount-live "$T5_SRC:/mnt/live" \
    -- /bin/sh -c "echo $T5_MARKER >/mnt/live/from-guest.txt && sync" \
    >"$T5_LOG" 2>&1 || true
  if [[ -f "$T5_SRC/from-guest.txt" ]] && grep -q "$T5_MARKER" "$T5_SRC/from-guest.txt"; then
    pass "guest write through default-rw live-mount visible on the host"
  else
    tail -80 "$T5_LOG" >&2
    echo "  host file: $(ls -la "$T5_SRC" 2>&1)" >&2
    fail "T5 marker ($T5_MARKER) not found in $T5_SRC/from-guest.txt"
  fi
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

# machinen exec --name <name> -- uname -m should return 0 + aarch64.
N2_EXEC_LOG="$FIXTURE/n2-exec.log"
if cli exec --name "$N2_NAME" -- uname -m >"$N2_EXEC_LOG" 2>&1; then
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
if cli attach --name "nope-does-not-exist-$$" >"$N3_LOG" 2>&1; then
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

# ---- N5: image carries a baked-in default cmd; `machinen boot
#          <image>` runs it without needing `-- <cmd>` ----
echo "N5: machinen boot <image-with-baked-cmd> (no -- cmd)"
N5_MARKER="baked-cmd-$$"
N5_IMG="$FIXTURE/baked-image.tar.gz"
N5_STAGE="$FIXTURE/baked-stage"
N5_LOG="$FIXTURE/n5.log"
# Stage a tarball that overlays the base rootfs and carries a
# /machinen-config.json pointing at /bin/echo. We untar the real
# release rootfs, drop in the config, and re-tar — cheaper than
# running a full provision() during smoke.
mkdir -p "$N5_STAGE"
tar -xzf "$ASSETS/rootfs-debian-arm64.tar.gz" -C "$N5_STAGE"
cat > "$N5_STAGE/machinen-config.json" <<JSON
{ "cmd": ["/bin/echo", "$N5_MARKER"] }
JSON
tar -C "$N5_STAGE" -czf "$N5_IMG" .
rm -rf "$N5_STAGE"
run_timeout 60 node "$CLI" boot "$N5_IMG" >"$N5_LOG" 2>&1 || true
if grep -q "$N5_MARKER" "$N5_LOG"; then
  pass "baked-in cmd fires without -- <cmd> on CLI"
else
  tail -50 "$N5_LOG" >&2
  fail "N5 — expected '$N5_MARKER' in guest output"
fi
rm -f "$N5_IMG"

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

# ---- P2: virtio_blk + vsock visible to userspace at boot ----
# Drivers are now compiled into the kernel (#119), so /proc/modules is
# empty. Instead, prove they're live: /sys/class/block/vda exists once
# virtio_blk has bound, and /proc/net/protocols lists AF_VSOCK once
# vsock + virtio_vsock are linked in.
echo "P2: machinen boot -- /sys/class/block/vda + AF_VSOCK in /proc/net/protocols"
P2_LOG="$FIXTURE/p2.log"
run_timeout 60 node "$CLI" boot -- /bin/sh -c \
  'ls /sys/class/block/vda 2>/dev/null && grep -E "^AF_VSOCK " /proc/net/protocols' \
  >"$P2_LOG" 2>&1 || true
if grep -q "/sys/class/block/vda" "$P2_LOG" && grep -qE "^AF_VSOCK " "$P2_LOG"; then
  pass "kernel has virtio_blk + vsock built in (/dev/vda + AF_VSOCK live)"
else
  tail -50 "$P2_LOG" >&2
  fail "P2 — expected /sys/class/block/vda and AF_VSOCK in /proc/net/protocols"
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


# ----------------------------------------------------------------
# Snapshot/restore round-trip (#50 M2). Uses the supervisor +
# /sbin/machinen-dump + /sbin/machinen-restore baked into the rootfs:
#   1. boot with a scratch /dev/vda + named VM
#   2. `machinen snapshot --name <n> --out-dir <d>`   (attach-snapshot)
#   3. `machinen restore <d>`                          (criu-ns restore)
#   4. exec into the restored VM (auto-named <n>/<pid>) to prove the
#      agent re-spawned
# ----------------------------------------------------------------
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 ]]; then
  echo "S1: skipped (rootfs lacks vsock/criu/snapshot helpers)"
else
  echo "S1: boot + snapshot + restore round-trip"
  S1_NAME="snapshot-smoke-$$"
  S1_BG_LOG="$FIXTURE/s1-bg.log"
  S1_SNAP_DIR="$FIXTURE/s1-snap"
  S1_SCRATCH="$FIXTURE/s1-scratch.img"
  S1_RESTORE_LOG="$FIXTURE/s1-restore.log"

  # 256 MB sparse scratch disk. CRIU images for a minimal shell fit
  # well under a MB; the rest stays unallocated on disk.
  truncate -s 256M "$S1_SCRATCH"

  S1_PID=$(boot_bg "$S1_NAME" "$S1_BG_LOG" --snapshot "$S1_SCRATCH" -- \
    /bin/sh -c "while :; do sleep 1; done")
  cleanup_s1() {
    kill -TERM "$S1_PID" 2>/dev/null || true
    wait "$S1_PID" 2>/dev/null || true
  }
  trap 'cleanup_s1; rm -rf "$FIXTURE"' EXIT

  if ! wait_for_vm "$S1_NAME"; then
    tail -80 "$S1_BG_LOG" >&2
    fail "S1 — '$S1_NAME' never appeared in 'machinen ls'"
  fi
  pass "boot --name --snapshot registered '$S1_NAME'"

  # Confirm the supervisor's backgrounded exec-agent is live.
  S1_EXEC_LOG="$FIXTURE/s1-exec.log"
  if cli exec --name "$S1_NAME" -- uname -m >"$S1_EXEC_LOG" 2>&1 \
     && grep -qE "aarch64|arm64" "$S1_EXEC_LOG"; then
    pass "exec-agent responds on the dump-side VM"
  else
    cat "$S1_EXEC_LOG" >&2
    tail -60 "$S1_BG_LOG" >&2
    fail "S1 — exec against dump-side VM didn't return arch"
  fi

  # Snapshot via the attach path. The bundle (disk.img + meta.json)
  # lands at $S1_SNAP_DIR; the VM exits as part of the dump.
  S1_DUMP_LOG="$FIXTURE/s1-dump.log"
  if ! cli snapshot --name "$S1_NAME" --out-dir "$S1_SNAP_DIR" 2>"$S1_DUMP_LOG"; then
    tail -60 "$S1_BG_LOG" >&2
    cat "$S1_DUMP_LOG" >&2
    fail "S1 — 'machinen snapshot' failed"
  fi
  wait "$S1_PID" 2>/dev/null || true
  pass "'machinen snapshot' returned 0"

  S1_DISK="$S1_SNAP_DIR/disk.img"
  if [[ ! -s "$S1_DISK" ]]; then
    ls -la "$S1_SNAP_DIR" >&2
    fail "S1 — snapshot disk.img is empty or missing"
  fi
  if [[ ! -f "$S1_SNAP_DIR/meta.json" ]]; then
    ls -la "$S1_SNAP_DIR" >&2
    fail "S1 — snapshot bundle missing meta.json"
  fi
  if ! file "$S1_DISK" 2>/dev/null | grep -qiE "ext[0-9] filesystem"; then
    file "$S1_DISK" >&2 || true
    fail "S1 — snapshot disk.img is not an ext filesystem"
  fi
  pass "snapshot bundle has ext4 disk.img + meta.json"

  # Restore in the background. The auto-name is "<source>/<pid>";
  # find the restored VM by listing names that start with the source.
  node "$CLI" restore "$S1_SNAP_DIR" >"$S1_RESTORE_LOG" 2>&1 &
  S1_RESTORE_PID=$!
  cleanup_s1_restore() {
    kill -TERM "$S1_RESTORE_PID" 2>/dev/null || true
    wait "$S1_RESTORE_PID" 2>/dev/null || true
  }
  trap 'cleanup_s1; cleanup_s1_restore; rm -rf "$FIXTURE"' EXIT

  S1_RESTORED_NAME=""
  deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S1_NAME/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S1_RESTORED_NAME=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S1_RESTORED_NAME" ]]; then
    tail -80 "$S1_RESTORE_LOG" >&2
    cli ls >&2 || true
    fail "S1 — restored VM never registered"
  fi
  pass "restored VM auto-named as '$S1_RESTORED_NAME'"

  S1_RESTORE_EXEC_LOG="$FIXTURE/s1-restore-exec.log"
  if cli exec --name "$S1_RESTORED_NAME" -- uname -m >"$S1_RESTORE_EXEC_LOG" 2>&1 \
     && grep -qE "aarch64|arm64" "$S1_RESTORE_EXEC_LOG"; then
    pass "exec-agent responds on the restored VM"
  else
    cat "$S1_RESTORE_EXEC_LOG" >&2
    tail -60 "$S1_RESTORE_LOG" >&2
    fail "S1 — exec against restored VM failed"
  fi

  cleanup_s1_restore
  trap 'rm -rf "$FIXTURE"' EXIT
fi  # S1 rootfs-capability gate

echo
echo "all smoke tests passed"
