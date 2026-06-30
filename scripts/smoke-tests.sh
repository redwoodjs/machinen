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
#   - packages/microvm/zig-out/bin/machinen-vm  (~30s on first run)
#   - packages/runtime/native/zig-out/bin/machinen-runtime-helper  (fast)
#   - release-assets/ (kernel, optional dtb, rootfs tarball)  (~5 min, needs Docker)
#
# Tests:
#   V1-V4  Validation paths (no boot): host-missing, host-is-a-file,
#          guest-outside-/mnt/, second --mount.
#   V5-V9  --mount-live validation, including mode modifiers — #78, #151.
#   T1     Base-only boot — `echo hello-world` reaches the host console.
#   T2     --mount exposes a host directory readable inside the guest.
#   T3v    --mount-live :ro streams host data and rejects guest writes — #332.
#   T5v    --mount-live :rw guest writes flush to the host — #332.
#   T5b    --mount-live :rw stages writes and flushes on workload exit.
#   T9v    filesystem-op battery over a virtio-fs live mount — #332.
#   T4     --env propagates into the guest process env — #89.
#   P1-P4  Base-rootfs/proof-fixture contract (criu, mounted portable
#          proof workload, virtio modules, poweroff) — #77, #379.
#   N1-N5  New #93 CLI surface: ls, exec, attach-unknown, completion,
#          plus image-carries-cmd default.
#   B0-B1  virtio-balloon free-page-reporting — #263.
#
# Snapshot / restore / fork (the S-series) live in their own script —
# scripts/smoke-test-snapshot-restore-fork.sh, invoked via
# `pnpm smoke-test-snapshot-restore-fork` — so they can run against
# both snapshot engines (criu, vmstate).

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"
# Staged location matches what the runtime resolver and mn-dev use.
# Shares the inputs-sha256 sidecar that check-asset-freshness.sh
# writes/reads, so a smoke run after an mn-dev session doesn't see a
# stale "vmm" report and vice versa.
ASSETS="$ROOT/release-assets"
OS=$(uname -s)
HOST_ARCH=$(uname -m)
case "$OS:$HOST_ARCH" in
  Darwin:arm64) HOST_NATIVE_PKG="native-arm64-darwin" ;;
  Linux:aarch64|Linux:arm64) HOST_NATIVE_PKG="native-arm64-linux" ;;
  Linux:x86_64|Linux:amd64) HOST_NATIVE_PKG="native-x64-linux" ;;
  *) echo "smoke: unsupported host: $OS/$HOST_ARCH" >&2; exit 1 ;;
esac
VMM="$ROOT/packages/$HOST_NATIVE_PKG/vmm/bin/machinen-vm"
RUNTIME_HELPER="$ROOT/packages/$HOST_NATIVE_PKG/vmm/bin/machinen-runtime-helper"

GUEST_ARCH="${MACHINEN_GUEST_ARCH:-}"
if [[ -z "$GUEST_ARCH" ]]; then
  case "$HOST_ARCH" in
    x86_64|amd64) GUEST_ARCH="amd64" ;;
    *) GUEST_ARCH="arm64" ;;
  esac
fi
case "$GUEST_ARCH" in
  arm64)
    KERNEL_ASSET="Image-arm64"
    DTB_ASSET="virt-arm64.dtb"
    ROOTFS_ASSET="rootfs-debian-arm64.tar.gz"
    ;;
  amd64|x86_64|x64)
    GUEST_ARCH="amd64"
    KERNEL_ASSET="bzImage-x86_64"
    DTB_ASSET=""
    ROOTFS_ASSET="rootfs-debian-amd64.tar.gz"
    ;;
  *) echo "smoke: MACHINEN_GUEST_ARCH must be arm64 or amd64 (got $GUEST_ARCH)" >&2; exit 1 ;;
esac
case "$GUEST_ARCH" in
  arm64) GUEST_UNAME_RE="aarch64|arm64"; GUEST_UNAME_LABEL="aarch64" ;;
  amd64) GUEST_UNAME_RE="x86_64|amd64"; GUEST_UNAME_LABEL="x86_64" ;;
esac

assets_complete() {
  [[ -f "$ASSETS/$KERNEL_ASSET" && -f "$ASSETS/$ROOTFS_ASSET" ]] || return 1
  [[ -z "$DTB_ASSET" || -f "$ASSETS/$DTB_ASSET" ]]
}

# ----------------------------------------------------------------
# Prereq checks
# ----------------------------------------------------------------

missing=()
for bin in zig; do
  command -v "$bin" >/dev/null || missing+=("$bin")
done
if [[ "$GUEST_ARCH" == "arm64" ]]; then
  command -v dtc >/dev/null || missing+=("dtc")
fi

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
if ! assets_complete; then
  if ! command -v docker >/dev/null; then
    echo "smoke: missing prerequisite: docker (needed to build release-assets/)" >&2
    exit 1
  fi
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
# build-vmm.sh handles zig build + codesign + staging copy + writing
# the inputs-sha256 sidecar that the freshness check below consumes.
echo "=== building VMM ==="
bash "$ROOT/scripts/build-vmm.sh"

echo "=== building machinen-runtime-helper ==="
bash "$ROOT/scripts/build-runtime-helper.sh"

if ! assets_complete; then
  echo "=== building $GUEST_ARCH base assets (~5 min on first run, cached after) ==="
  MACHINEN_GUEST_ARCH="$GUEST_ARCH" "$ROOT/scripts/build-base-assets.sh"
fi

# Catch a stale rootfs / kernel before booting. Without this, an
# out-of-date /sbin/machinen-dump (e.g. release-assets/ predates a
# host-side change to the snapshot protocol) produces a 10s vsock
# timeout in S1 that looks like a runtime regression. The checker
# diffs source-file hashes against sidecars baked at build time;
# missing sidecars (older release-assets/) just warn.
if ! MACHINEN_GUEST_ARCH="$GUEST_ARCH" "$ROOT/scripts/check-asset-freshness.sh" --quiet; then
  echo "smoke: release-assets/ is stale — rebuild with MACHINEN_GUEST_ARCH=$GUEST_ARCH bash $ROOT/scripts/build-base-assets.sh" >&2
  exit 1
fi

# Always rebuild — without this, a stale `dist/cli.js` from a prior
# run silently masks source changes, and a "passing" smoke run can
# actually be exercising the previous PR's code. tsup itself is fast
# (~1s); the extra cost is negligible next to a single VM boot.
echo "=== building @machinen/runtime + @machinen/cli ==="
pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null

# Stage gvproxy next to the locally-built VMM so the runtime's
# sibling-lookup in resolveGvproxyBinary() finds it. Same script the
# release workflow runs (see .github/workflows/release.yml) — single
# source of truth for the pinned version.
"$ROOT/scripts/install-gvproxy.sh" --dest "$(dirname "$VMM")"

export MACHINEN_VMM="$VMM"
export MACHINEN_RUNTIME_HELPER="$RUNTIME_HELPER"
export MACHINEN_ASSETS_DIR="$ASSETS"
export MACHINEN_GUEST_ARCH="$GUEST_ARCH"

echo
echo "smoke: VMM=$MACHINEN_VMM"
echo "smoke: RUNTIME_HELPER=$MACHINEN_RUNTIME_HELPER"
echo "smoke: ASSETS=$MACHINEN_ASSETS_DIR"
echo "smoke: GUEST_ARCH=$MACHINEN_GUEST_ARCH"
echo

# Capability probe: N-series (vsock exec) and P/C-series (criu, fnm)
# need a #77+ rootfs. Peek inside the tarball for marker files; skip
# dependent sections with a warning if we're running against a stale
# (pre-#77) rootfs. Rebuild with ./scripts/build-base-assets.sh to
# pick them up.
ROOTFS_TAR="$ASSETS/$ROOTFS_ASSET"
ROOTFS_SUPPORTS_VSOCK_EXEC=1
ROOTFS_SUPPORTS_CRIU=1
ROOTFS_SUPPORTS_SNAPSHOT_HELPERS=1
# Probe the rootfs tarball once. We can't `tar tzf | grep -q` directly
# under `set -o pipefail`: grep -q exits as soon as it finds a match,
# tar gets SIGPIPE on its next write and exits 141, and pipefail
# surfaces that 141 — every probe lights up "missing" even when the
# entry is right there. Linux GNU tar reproduces this; BSD tar on
# darwin happens to absorb it, which is why this only manifests on
# linux smoke runs and the regression went silent for a while.
ROOTFS_ENTRIES=$(tar tzf "$ROOTFS_TAR" 2>/dev/null || true)
# vsock support moved from /lib/modules into the kernel image (#119),
# so the modern marker is /exec-agent in the rootfs (#93's vsock-using
# helper) rather than the old `vmw_vsock_virtio_transport.ko` path.
if ! grep -q "^./exec-agent$" <<<"$ROOTFS_ENTRIES"; then
  echo "smoke: WARN rootfs lacks /exec-agent — N-series (vm.exec) will be skipped"
  ROOTFS_SUPPORTS_VSOCK_EXEC=0
fi
if ! grep -q "usr/sbin/criu" <<<"$ROOTFS_ENTRIES"; then
  echo "smoke: WARN rootfs lacks criu — P/C-series will be skipped"
  ROOTFS_SUPPORTS_CRIU=0
fi
if ! grep -q "sbin/machinen-dump" <<<"$ROOTFS_ENTRIES"; then
  echo "smoke: WARN rootfs lacks /sbin/machinen-dump — S-series (snapshot) will be skipped"
  ROOTFS_SUPPORTS_SNAPSHOT_HELPERS=0
fi
ROOTFS_SUPPORTS_MEMDIRTY=1
if ! grep -q "sbin/machinen-memdirty" <<<"$ROOTFS_ENTRIES"; then
  echo "smoke: WARN rootfs lacks /sbin/machinen-memdirty — S5 (headline RSS) will be skipped"
  ROOTFS_SUPPORTS_MEMDIRTY=0
fi
ROOTFS_SUPPORTS_MOVE_CAPTURE=1
if ! grep -q "sbin/machinen-move-capture" <<<"$ROOTFS_ENTRIES"; then
  echo "smoke: WARN rootfs lacks /sbin/machinen-move-capture — move-capture helpers unavailable"
  ROOTFS_SUPPORTS_MOVE_CAPTURE=0
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
  "V8: --mount-live rejects an unknown trailing modifier" \
  "trailing modifier must be" \
  boot --mount-live "$EMPTY_DIR:/mnt/x:xx" -- true

expect_cli_error \
  "V9: --mount-live rejects a spec with too many colons" \
  "expected <host-dir>:<guest-path>" \
  boot --mount-live "$EMPTY_DIR:/mnt/x:rw:extra" -- true

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

# ---- T3v: --mount-live :ro streams a file through virtio-fs (#332) ----
#
# Unlike T2 (copy-once), the host file must land in the guest lazily
# via the in-VMM virtio-fs device, NOT be baked into the boot cpio. We
# write the marker after the VM starts to prove that. Needs a guest
# kernel with CONFIG_VIRTIO_FS — every machinen-built kernel has it; a
# stale Image without it surfaces here as a missing marker.
#
# #338 removed the FUSE-over-vsock transport, so this is the only
# `--mount-live` streaming path.
echo "T3v: machinen boot --mount-live ./fixture:/mnt/live:ro -- read and reject writes"
T3V_MARKER="virtiofs-ro-marker-$$"
T3V_SRC="$FIXTURE/virtiofs-ro-src"
T3V_LOG="$FIXTURE/t3v.log"
mkdir -p "$T3V_SRC"
# Seed the marker file AFTER the VM is already running to prove the
# read streamed in (copy-once would have cached an empty dir at boot).
(
  sleep 3
  echo "$T3V_MARKER" >"$T3V_SRC/hello.txt"
) &
T3V_SEEDER=$!
# Explicit `:ro` since the default is `:rw` (#156); this test
# intentionally exercises the read-only path.
run_timeout 60 node "$CLI" boot \
  --mount-live "$T3V_SRC:/mnt/live:ro" \
  -- /bin/sh -c 'sleep 4 && cat /mnt/live/hello.txt && if (echo nope >/mnt/live/blocked.txt) 2>/tmp/ro.err; then echo ro-write-succeeded; else echo ro-write-blocked; fi' \
  >"$T3V_LOG" 2>&1 || true
wait "$T3V_SEEDER" 2>/dev/null || true
if grep -q "$T3V_MARKER" "$T3V_LOG" && grep -q "ro-write-blocked" "$T3V_LOG" && [[ ! -e "$T3V_SRC/blocked.txt" ]]; then
  pass "read-only live-mount streamed host data and rejected guest writes"
else
  tail -80 "$T3V_LOG" >&2
  fail "T3v either missed the marker or allowed a write through read-only live mount"
fi

# ---- T5v: --mount-live :rw over virtio-fs — guest write flushes to host (#151, #332) ----
#
# Mode left unset so the default-`:rw` (#156) path is exercised. The
# guest echoes a marker into a file under the mount; we assert it
# appears on the host with the right contents after the VM exits.
echo "T5v: machinen boot --mount-live (default :rw) — guest write reaches the host"
T5V_MARKER="virtiofs-rw-marker-$$"
T5V_SRC="$FIXTURE/virtiofs-rw-src"
T5V_LOG="$FIXTURE/t5v.log"
mkdir -p "$T5V_SRC"
run_timeout 60 node "$CLI" boot \
  --mount-live "$T5V_SRC:/mnt/live:rw" \
  -- /bin/sh -c "echo $T5V_MARKER >/mnt/live/from-guest.txt && sync" \
  >"$T5V_LOG" 2>&1 || true
if [[ -f "$T5V_SRC/from-guest.txt" ]] && grep -q "$T5V_MARKER" "$T5V_SRC/from-guest.txt"; then
  pass "guest write through :rw virtio-fs live-mount visible on the host after flush"
else
  tail -80 "$T5V_LOG" >&2
  echo "  host file: $(ls -la "$T5V_SRC" 2>&1)" >&2
  fail "T5v marker ($T5V_MARKER) not found in $T5V_SRC/from-guest.txt"
fi

# ---- T5b: --mount-live :rw flushes staged writes at workload exit ----
echo "T5b: machinen boot --mount-live :rw — guest writes flush at workload exit"
T5B_MARKER="virtiofs-batch-marker-$$"
T5B_SRC="$FIXTURE/virtiofs-batch-src"
T5B_LOG="$FIXTURE/t5b.log"
mkdir -p "$T5B_SRC"
echo "delete-me" >"$T5B_SRC/delete-me.txt"
run_timeout 60 node "$CLI" boot \
  --mount-live "$T5B_SRC:/mnt/live:rw" \
  -- /bin/sh -c "echo $T5B_MARKER >/mnt/live/from-guest.txt && rm /mnt/live/delete-me.txt" \
  >"$T5B_LOG" 2>&1 || true
if [[ -f "$T5B_SRC/from-guest.txt" ]] && grep -q "$T5B_MARKER" "$T5B_SRC/from-guest.txt" && [[ ! -e "$T5B_SRC/delete-me.txt" ]]; then
  pass "guest write/delete through :rw live-mount flushed on workload exit"
else
  tail -80 "$T5B_LOG" >&2
  echo "  host file: $(ls -la "$T5B_SRC" 2>&1)" >&2
  fail "T5b batch flush did not publish expected host tree"
fi

# ---- T9v: filesystem-operations coverage over a virtio-fs live mount ----
#
# T3v/T5v each prove a live mount carries a single read or a single
# write. This exercises the rest of the filesystem surface the #329
# FUSE handlers implement — directories, nested paths, readdir, unlink,
# empty rmdir, non-empty rmdir errno mapping, recursive rm, symlink
# create/read/follow, hardlink create/use, chmod +x/exec, and a
# multi-frame large file — over the in-VMM virtio-fs transport (#332,
# the only transport since #338).
fs_ops_smoke() {
  local label="T9v"
  echo "$label: filesystem operations over a --mount-live (virtio-fs) mount"

  local marker="fs-ops-$$"
  local src="$FIXTURE/fs-ops"
  local log="$FIXTURE/fs-ops.log"
  mkdir -p "$src"
  printf 'old-data\n' >"$src/existing.txt"
  printf 'append-base\n' >"$src/append.txt"
  printf 'copy-target-old\n' >"$src/copy-target.txt"
  printf 'rename-target-old\n' >"$src/rename-dst.txt"
  printf 'truncate-me\n' >"$src/truncate.txt"
  local fs_fail
  fs_fail() {
    tail -80 "$log" >&2 || true
    ls -laR "$src" 2>&1 | head -40 >&2 || true
    fail "$1"
  }

  # One guest script: a battery of filesystem ops under /mnt/fs, a
  # read-back, then a unique marker. `set -e` aborts on the first
  # failure, so a missing marker means something in the battery broke.
  # `\$(...)` is escaped so the *guest* shell evaluates it.
  # `seq 1 50000` is ~288 KiB — a deliberately multi-frame payload. The
  # guest both writes it and reads it straight back, so the descriptor-
  # chain gather (write) and scatter (read) are each exercised past the
  # one-page boundary.
  run_timeout 90 node "$CLI" boot \
    --mount-live "$src:/mnt/fs:rw" \
    -- /bin/sh -c "
      set -e
      mkdir -p /mnt/fs/d/nested
      echo nested-content > /mnt/fs/d/nested/a.txt
      seq 1 50000 > /mnt/fs/big.txt
      echo bigread: \$(wc -l < /mnt/fs/big.txt | tr -d ' ')
      echo overwritten > /mnt/fs/existing.txt
      echo appended >> /mnt/fs/append.txt
      cp /mnt/fs/d/nested/a.txt /mnt/fs/copy-target.txt
      echo renamed-source > /mnt/fs/rename-src.txt
      mv /mnt/fs/rename-src.txt /mnt/fs/rename-dst.txt
      : > /mnt/fs/truncate.txt
      echo doomed > /mnt/fs/doomed.txt && rm /mnt/fs/doomed.txt
      mkdir /mnt/fs/emptydir && rmdir /mnt/fs/emptydir
      mkdir /mnt/fs/nonempty
      echo kept > /mnt/fs/nonempty/file.txt
      if rmdir /mnt/fs/nonempty 2>/tmp/rmdir-nonempty.err; then
        echo nonempty-rmdir-unexpected-success
        exit 1
      fi
      cat /tmp/rmdir-nonempty.err
      grep -q 'Directory not empty' /tmp/rmdir-nonempty.err
      rm -rf /mnt/fs/nonempty
      ln -s d/nested/a.txt /mnt/fs/link.txt
      echo linktarget: \$(readlink /mnt/fs/link.txt)
      echo linkcat: \$(cat /mnt/fs/link.txt)
      ls -la /mnt/fs/link.txt | grep -q -- '-> d/nested/a.txt'
      echo hard > /mnt/fs/hard-a.txt
      ln /mnt/fs/hard-a.txt /mnt/fs/hard-b.txt
      test \$(stat -c '%h' /mnt/fs/hard-a.txt) = 2
      echo hard-updated > /mnt/fs/hard-a.txt
      echo hardread: \$(cat /mnt/fs/hard-b.txt)
      rm /mnt/fs/hard-a.txt
      echo hardafterunlink: \$(cat /mnt/fs/hard-b.txt)
      printf '#!/bin/sh\necho live-exec\n' > /mnt/fs/run.sh
      chmod +x /mnt/fs/run.sh
      echo execread: \$(/mnt/fs/run.sh)
      echo readback: \$(cat /mnt/fs/d/nested/a.txt)
      echo readdir: \$(ls /mnt/fs/d/nested | tr '\n' ' ')
      sync
      echo $marker
    " >"$log" 2>&1 || true

  # Guest side: the battery ran to completion, a file round-tripped,
  # and the large file read back at full length (multi-frame scatter).
  grep -q "$marker" "$log" || fs_fail "$label: guest battery didn't reach the marker ($marker)"
  grep -q "readback: nested-content" "$log" || fs_fail "$label: file read-back wrong"
  grep -q "linktarget: d/nested/a.txt" "$log" || fs_fail "$label: readlink returned wrong target"
  grep -q "linkcat: nested-content" "$log" || fs_fail "$label: symlink follow failed"
  grep -q "hardread: hard-updated" "$log" || fs_fail "$label: hardlink read didn't see updated bytes"
  grep -q "hardafterunlink: hard-updated" "$log" || fs_fail "$label: hardlink didn't survive unlink of peer"
  grep -q "execread: live-exec" "$log" || fs_fail "$label: chmod +x script did not execute"
  grep -q "bigread: 50000" "$log" || fs_fail "$label: large file read back short (multi-frame scatter)"

  # Host side: every mutating op landed on the host directory.
  [[ "$(cat "$src/d/nested/a.txt" 2>/dev/null)" == "nested-content" ]] ||
    fs_fail "$label: nested file missing/wrong on host"
  [[ "$(wc -l <"$src/big.txt" 2>/dev/null | tr -d ' ')" == "50000" ]] ||
    fs_fail "$label: big.txt wrong line count on host (multi-frame write)"
  [[ "$(cat "$src/existing.txt" 2>/dev/null)" == "overwritten" ]] ||
    fs_fail "$label: overwrite of existing file failed on host"
  [[ "$(cat "$src/append.txt" 2>/dev/null)" == $'append-base\nappended' ]] ||
    fs_fail "$label: append to existing file failed on host"
  [[ "$(cat "$src/copy-target.txt" 2>/dev/null)" == "nested-content" ]] ||
    fs_fail "$label: cp over existing file failed on host"
  [[ "$(cat "$src/rename-dst.txt" 2>/dev/null)" == "renamed-source" ]] ||
    fs_fail "$label: rename over existing file failed on host"
  [[ ! -e "$src/rename-src.txt" ]] || fs_fail "$label: rename source still present on host"
  [[ ! -s "$src/truncate.txt" ]] || fs_fail "$label: truncate of existing file failed on host"
  [[ ! -e "$src/doomed.txt" ]] || fs_fail "$label: unlink didn't remove doomed.txt on host"
  [[ ! -e "$src/emptydir" ]] || fs_fail "$label: rmdir didn't remove emptydir on host"
  [[ ! -e "$src/nonempty" ]] || fs_fail "$label: rm -rf didn't remove nonempty on host"
  [[ -L "$src/link.txt" ]] || fs_fail "$label: symlink not present on host"
  [[ ! -e "$src/hard-a.txt" ]] || fs_fail "$label: hardlink peer unlink left hard-a.txt on host"
  [[ "$(cat "$src/hard-b.txt" 2>/dev/null)" == "hard-updated" ]] ||
    fs_fail "$label: hardlink surviving peer has wrong host bytes"
  [[ -x "$src/run.sh" ]] || fs_fail "$label: chmod +x did not set host executable bit"
  pass "fs ops (mkdir/write/overwrite/append/cp/rename/readdir/unlink/rmdir/rm-rf/symlink/hardlink/chmod-exec/large file) over virtio-fs"
}

fs_ops_smoke

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
# T6-T8: #272 mount-overlay end-to-end. T2 above proves the happy
# path; these check the load-bearing properties the cpio path could
# only guarantee by accident.
# ----------------------------------------------------------------

# ---- T6: sealed-fd — host source mutations after boot don't leak in ----
#
# Guarantee: the runtime opens the squashfs O_RDONLY before posix_spawn
# and the VMM holds that fd for the VM's life. Even if mksquashfs were
# re-run mid-VM (or someone mutates the host source dir on the side),
# the guest's view stays anchored to the original snapshot.
#
# Test: boot with --mount; inside the guest, write a marker through
# /tmp (which IS host-visible) so we know the VM is alive; then have
# the guest sleep, mutate the host source, ls /mnt/data, assert the
# new file is NOT visible inside the guest.
#
# Rather than juggle a long-lived VM, we exercise the simpler shape:
# write the host marker FIRST, boot, mutate the host source, exec
# `ls /mnt/data`. Because the VMM has already opened its fd, the
# mid-run host write must not appear.
echo "T6: --mount payload is sealed against mid-run host mutations"
T6_MARKER="sealed-marker-$$"
T6_LATE="late-host-write-$$"
T6_DIR="$FIXTURE/t6-host"
T6_LOG="$FIXTURE/t6.log"
mkdir -p "$T6_DIR"
echo "$T6_MARKER" >"$T6_DIR/anchored.txt"
# Boot a long-running shell so we can mutate the host between the VMM
# spawn and the guest's first read. The shell sleeps a beat, then ls's
# the mount.
( sleep 4; echo "$T6_LATE" >"$T6_DIR/late.txt" ) &
LATE_PID=$!
run_timeout 60 node "$CLI" boot \
  --mount "$T6_DIR:/mnt/data" \
  -- /bin/sh -c 'sleep 6; ls /mnt/data; cat /mnt/data/anchored.txt' \
  >"$T6_LOG" 2>&1 || true
wait $LATE_PID 2>/dev/null || true
if grep -q "$T6_MARKER" "$T6_LOG" && ! grep -q "late.txt" "$T6_LOG"; then
  pass "guest sees pre-boot bytes; mid-run host write was sealed out"
else
  tail -50 "$T6_LOG" >&2
  fail "T6 — guest either missed the anchored marker or saw the late host write"
fi

# ---- T7: snapshot durability + cross-host restore ----
#
# Guarantee: the snapshot bundle reflinks the squashfs lower + ext4
# upper into the bundle dir. Restore reads them back via fd, so the
# original host source dir is never consulted on restore — even when
# it doesn't exist on the restoring host.
#
# Test: boot with --mount; write a marker INTO /mnt/data from the
# guest (lands in the upper); snapshot; delete the host source dir;
# restore the snapshot; read /mnt/data/<marker>, assert it's there.
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 ]]; then
  echo "T7: skipped (rootfs lacks vsock/criu/snapshot helpers)"
else
  echo "T7: snapshot durability across the source dir disappearing"
  T7_NAME="t7-mount-snap-$$"
  T7_HOST="$FIXTURE/t7-host"
  T7_BUNDLE="$FIXTURE/t7-bundle"
  T7_BG_LOG="$FIXTURE/t7-bg.log"
  T7_SCRATCH="$FIXTURE/t7-scratch.img"
  truncate -s 256M "$T7_SCRATCH"
  mkdir -p "$T7_HOST"
  echo "from-host" >"$T7_HOST/seed.txt"
  # Background-boot the source. Inlining instead of using the
  # `boot_bg` / `wait_for_vm` helpers (defined further down) so this
  # block stays self-contained. --detached is incompatible with
  # --mount (#150 phase 3 lifts that restriction).
  node "$CLI" boot --name "$T7_NAME" \
    --mount "$T7_HOST:/mnt/data" \
    --snapshot "$T7_SCRATCH" \
    -- /bin/sh -c 'while :; do sleep 1000; done' \
    >"$T7_BG_LOG" 2>&1 &
  T7_PID=$!
  cleanup_t7() {
    kill -TERM "$T7_PID" 2>/dev/null || true
    wait "$T7_PID" 2>/dev/null || true
  }
  # Wait up to 30s for the VM to register.
  deadline=$((SECONDS + 30))
  vm_up=0
  while (( SECONDS < deadline )); do
    if node "$CLI" ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$T7_NAME"; then
      vm_up=1
      break
    fi
    sleep 1
  done
  if [[ "$vm_up" -ne 1 ]]; then
    tail -50 "$T7_BG_LOG" >&2
    cleanup_t7
    fail "T7 — '$T7_NAME' never appeared in 'machinen ls'"
  fi
  # Plant a marker into the writable upper from inside the guest.
  # cli exec joins post-`--` args with spaces and runs the result via
  # `sh -c` in the guest. The single-quoted `'>'` reaches the guest's
  # shell as a literal redirect operator, the same trick S3 uses to
  # write into /tmp/who.
  if ! node "$CLI" exec "$T7_NAME" -- echo guest-wrote '>' /mnt/data/from-guest.txt; then
    tail -50 "$T7_BG_LOG" >&2
    cleanup_t7
    fail "T7 — couldn't write to /mnt/data from the guest"
  fi
  # Snapshot. Vmstate checkpoints are non-destructive, so explicitly
  # stop the source after the bundle is written; CRIU snapshots may
  # already have exited, making cleanup_t7 a no-op.
  if ! node "$CLI" snapshot "$T7_NAME" "$T7_BUNDLE" >>"$T7_BG_LOG" 2>&1; then
    tail -50 "$T7_BG_LOG" >&2
    cleanup_t7
    fail "T7 — machinen snapshot failed"
  fi
  cleanup_t7
  # Now make the original host source disappear. The bundle's
  # mount-lower.sqfs and mount-upper.img must carry the data forward.
  rm -rf "$T7_HOST"
  if [[ -f "$T7_BUNDLE/mount-lower.sqfs" && -f "$T7_BUNDLE/mount-upper.img" ]]; then
    pass "snapshot bundle carries mount-lower.sqfs + mount-upper.img"
  else
    ls -la "$T7_BUNDLE" >&2
    fail "T7 — bundle missing mount-lower.sqfs / mount-upper.img"
  fi
  # Restore. Auto-named under the source.
  T7_RESTORE_LOG="$FIXTURE/t7-restore.log"
  T7_RESTORE_BG_LOG="$FIXTURE/t7-restore-bg.log"
  node "$CLI" restore "$T7_BUNDLE" >"$T7_RESTORE_BG_LOG" 2>&1 &
  T7_RESTORE_PID=$!
  cleanup_t7_restore() {
    kill -TERM "$T7_RESTORE_PID" 2>/dev/null || true
    wait "$T7_RESTORE_PID" 2>/dev/null || true
  }
  # Wait for the restored VM under "$T7_NAME/<pid>" or "$T7_NAME~<pid>".
  T7_RESTORE_NAME=""
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    cand=$(node "$CLI" ls 2>/dev/null | awk -v src="$T7_NAME" 'NR>1 && (index($2, src "/")==1 || index($2, src "~")==1) {print $2; exit}')
    if [[ -n "$cand" ]]; then
      T7_RESTORE_NAME=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$T7_RESTORE_NAME" ]]; then
    node "$CLI" ls >&2
    tail -50 "$T7_RESTORE_BG_LOG" >&2
    cleanup_t7_restore
    fail "T7 — restored VM never registered"
  fi
  if node "$CLI" exec "$T7_RESTORE_NAME" -- cat /mnt/data/from-guest.txt 2>>"$T7_RESTORE_LOG" | grep -q "guest-wrote"; then
    pass "restored guest sees writes the source guest made into the upper"
  else
    tail -50 "$T7_RESTORE_LOG" >&2
    cleanup_t7_restore
    fail "T7 — restored guest can't read from-guest.txt"
  fi
  if node "$CLI" exec "$T7_RESTORE_NAME" -- cat /mnt/data/seed.txt 2>>"$T7_RESTORE_LOG" | grep -q "from-host"; then
    pass "restored guest sees pre-snapshot host bytes after the source dir is gone"
  else
    tail -50 "$T7_RESTORE_LOG" >&2
    cleanup_t7_restore
    fail "T7 — restored guest can't read seed.txt"
  fi
  cleanup_t7_restore
fi

# ---- T8: /init mount-order — overlay is up before the user cmd runs ----
#
# Guarantee: bringUpMountDisk runs before /init exec's the user's
# command. The user's `cat /proc/self/mounts` therefore shows an
# overlay entry rooted at the guest path.
echo "T8: /init mounts the --mount overlay before the user cmd runs"
T8_DIR="$FIXTURE/t8-host"
T8_LOG="$FIXTURE/t8.log"
mkdir -p "$T8_DIR"
echo "anchor" >"$T8_DIR/anchor.txt"
run_timeout 60 node "$CLI" boot \
  --mount "$T8_DIR:/mnt/t8" \
  -- /bin/sh -c 'cat /proc/self/mounts' \
  >"$T8_LOG" 2>&1 || true
# Overlayfs lines are formatted like:
#   overlay /mnt/t8 overlay rw,relatime,...
if grep -E '(^|\] )overlay /mnt/t8 overlay ' "$T8_LOG" >/dev/null; then
  pass "/proc/self/mounts shows overlay rooted at the guest path"
else
  tail -50 "$T8_LOG" >&2
  fail "T8 — overlay mount missing from /proc/self/mounts at user-cmd time"
fi

# ----------------------------------------------------------------
# M-series: #263 phase A — auto-sized RAM ceiling + --memory knob.
# Each boot cats /proc/meminfo into the kernel console; we assert the
# guest's MemTotal lands in the expected band. MemTotal is reported in
# kB and is always less than the configured ceiling: the kernel
# reserves bookkeeping (~1-2% on small VMs, ~0.1% on large ones).
# ----------------------------------------------------------------

# Helper: extract MemTotal in MiB from a console log (kB / 1024,
# floored). Returns 0 if the line wasn't captured.
mem_total_mib() {
  local log=$1
  awk '{ for (i = 1; i <= NF; i++) if ($i == "MemTotal:") { printf("%d\n", $(i + 1) / 1024); exit } }' "$log" 2>/dev/null || echo 0
}

# ---- M0: --memory rejects bogus values via the parser ----
expect_cli_error \
  "M0a: --memory 0 rejected" \
  "must be > 0" \
  boot --memory 0 -- true

expect_cli_error \
  "M0b: --memory 1G rejected (no unit suffix)" \
  "decimal integer" \
  boot --memory 1G -- true

# ---- M1: default boot — guest sees a sane auto-sized MemTotal ----
echo "M1: machinen boot — auto-sized MemTotal"
M1_LOG="$FIXTURE/m1.log"
run_timeout 60 node "$CLI" boot -- /bin/sh -c \
  'cat /proc/meminfo | grep ^MemTotal' \
  >"$M1_LOG" 2>&1 || true
M1_MIB=$(mem_total_mib "$M1_LOG")
# Auto-size policy: min(host_ram/2, 4096) MiB, floor 512. So the
# guest can land anywhere in [400, 5000] MiB once the kernel takes
# its cut. A value below 400 means the patch silently fell back to
# too small a VM; above 5000 means the default started scaling with
# large developer machines again.
if (( M1_MIB >= 400 && M1_MIB <= 5000 )); then
  pass "default MemTotal ${M1_MIB} MiB lands in the auto-size band"
else
  cat "$M1_LOG" >&2
  fail "M1 — MemTotal ${M1_MIB} MiB outside the expected auto-size band [400..5000]"
fi

# ---- M2: --memory 1024 — guest sees ~1 GiB ----
echo "M2: machinen boot --memory 1024"
M2_LOG="$FIXTURE/m2.log"
run_timeout 60 node "$CLI" boot --memory 1024 -- /bin/sh -c \
  'cat /proc/meminfo | grep ^MemTotal' \
  >"$M2_LOG" 2>&1 || true
M2_MIB=$(mem_total_mib "$M2_LOG")
# 1024 MiB requested → MemTotal usually ~960-1010 MiB after the
# kernel's reservation. Tolerate [900, 1024].
if (( M2_MIB >= 900 && M2_MIB <= 1024 )); then
  pass "--memory 1024 → MemTotal ${M2_MIB} MiB"
else
  cat "$M2_LOG" >&2
  fail "M2 — MemTotal ${M2_MIB} MiB outside the expected --memory 1024 band [900..1024]"
fi

# ---- M3: --memory 32768 — guest sees ~32 GiB ----
# This exercises the larger-than-DTB-default path: the shipped DTB
# hardcodes 4 GiB, so without dtb_patch.patchMemorySize the guest
# would clamp to 4 GiB and this would fail.
echo "M3: machinen boot --memory 32768"
if [[ "$GUEST_ARCH" == "amd64" ]]; then
  echo "  skip: x86_64 KVM hosts used for local smoke may not allow a 32 GiB guest mapping"
else
  M3_LOG="$FIXTURE/m3.log"
  run_timeout 60 node "$CLI" boot --memory 32768 -- /bin/sh -c \
    'cat /proc/meminfo | grep ^MemTotal' \
    >"$M3_LOG" 2>&1 || true
  M3_MIB=$(mem_total_mib "$M3_LOG")
  # 32 GiB requested. With lazy commit the host doesn't pay 32 GiB of
  # RSS — only address-space mapping. Tolerate [30 GiB, 32 GiB].
  if (( M3_MIB >= 30000 && M3_MIB <= 32768 )); then
    pass "--memory 32768 → MemTotal ${M3_MIB} MiB (DTB memory@ size patch effective)"
  else
    cat "$M3_LOG" >&2
    fail "M3 — MemTotal ${M3_MIB} MiB outside the expected --memory 32768 band [30000..32768]"
  fi
fi

# ----------------------------------------------------------------
# Helpers that B-series and the later N/P/S sections share.
# Hoisted here because B1 boots a long-lived named VM the same way
# N2 / S1 do. Scratch registry redirects `boot()`'s writeEntry and
# `list()`/`attach()`'s lookups so we don't collide with the user's
# real ~/.machinen/vms entries.
# ----------------------------------------------------------------
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

# ----------------------------------------------------------------
# B-series: #263 phase B — virtio-balloon free-page-reporting.
#
# B0  device bound + feature-negotiated inside the guest.
# B1  spike-and-idle reclaim: drive a 1 GiB workload through dirty
#     anon pages, free it, wait for the kernel's free-page-reporting
#     thread to fire, assert host RSS drops back close to baseline.
#
# Host RSS is read via `ps -o rss= -p <vmm_pid>` (KiB, portable
# across darwin + linux). The VMM pid comes from `cli ls`. RSS is
# best-effort — kernel page reporting batches and is gated on
# free-area watermarks, so a tight tolerance would flake.
# ----------------------------------------------------------------

# Helper: resolve the actual VMM pid from a registry-recorded pid.
# `cli ls` reports the pdeathsig shim pid (a ~1 MiB watcher that
# SIGTERMs the VMM if the parent dies). Its only child is the real
# machinen-vm. Falls back to the input pid if pgrep finds no child
# — happens when the caller passed a non-shim pid directly.
vmm_real_pid() {
  local outer=$1
  local child
  child=$(pgrep -P "$outer" 2>/dev/null | head -1)
  if [[ -n "$child" ]]; then
    echo "$child"
  else
    echo "$outer"
  fi
}

# Helper: read VMM resident memory in MiB. Reports 0 if `ps` can't
# see the pid. Resolves through the pdeathsig shim if the input pid
# wraps one. This is `task_basic_info.resident_size` on Darwin / VmRSS
# on Linux — what's *currently in physical RAM*. The S-series tests
# need this metric (lazy-pages restore: did the new VMM bring pages
# back into RAM?). The B-series uses `vmm_phys_footprint_mib` below
# instead (Darwin's `phys_footprint` excludes `MADV_FREE_REUSABLE`
# pages so balloon reclaim is observable, but it counts any page
# CRIU's UFFDIO_COPY ever charged — which inflates the lazy-pages
# fork measurement past the parent's at restore-time).
vmm_rss_mib() {
  local outer=$1
  local pid
  pid=$(vmm_real_pid "$outer")
  local kib
  kib=$(ps -o rss= -p "$pid" 2>/dev/null | awk 'NR==1 { print $1 }')
  if [[ -z "$kib" || "$kib" == "0" ]]; then
    echo 0
  else
    echo $(( kib / 1024 ))
  fi
}

# Helper: read this VMM's `phys_footprint` (Darwin) / VmRSS (Linux)
# in MiB via the registry entry's stats file. After balloon reclaim
# (`MADV_FREE_REUSABLE` on Darwin), `task_basic_info.resident_size`
# stays high until the kernel actually reclaims under pressure, so
# `ps -o rss=` makes B1's drop-after-free look like a flat line.
# `phys_footprint` excludes reusable pages immediately and is what
# `vm.memoryStats().hostRssBytes` exposes — read it through the same
# CLI path so the test pins the user-visible number.
vmm_phys_footprint_mib() {
  local outer=$1
  local bytes
  bytes=$(node "$CLI" ls --json 2>/dev/null \
    | node -e '
        let raw = "";
        process.stdin.on("data", d => raw += d);
        process.stdin.on("end", () => {
          try {
            const j = JSON.parse(raw);
            const hit = (j.vms || []).find(v => v.pid == process.argv[1]);
            process.stdout.write(String((hit && hit.memory && hit.memory.rss_bytes) || 0));
          } catch { process.stdout.write("0"); }
        });
      ' "$outer")
  if [[ -z "$bytes" || "$bytes" == "0" ]]; then
    echo 0
  else
    echo $(( bytes / 1024 / 1024 ))
  fi
}

# ---- B0: balloon device bound + feature flags negotiated ----
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 ]]; then
  echo "B0: skipped (rootfs lacks vsock-exec)"
else
echo "B0: virtio-balloon driver bound to slot 4"
B0_LOG="$FIXTURE/b0.log"
run_timeout 60 node "$CLI" boot -- /bin/sh -c \
  'echo "DRIVER=$(readlink /sys/bus/virtio/devices/virtio4/driver | xargs basename)"; echo "DEVICE=$(cat /sys/bus/virtio/devices/virtio4/device)"' \
  >"$B0_LOG" 2>&1 || true
# `readlink` of /sys/bus/virtio/devices/virtio4/driver should resolve
# to .../drivers/virtio_balloon when our slot 4 device is bound. The
# guest's virtio_balloon driver is built-in (CONFIG_VIRTIO_BALLOON=y);
# binding fails only if our feature set is one the driver refuses.
if grep -q "DRIVER=virtio_balloon" "$B0_LOG" && grep -q "DEVICE=0x0005" "$B0_LOG"; then
  pass "balloon driver bound to virtio4 (device id 0x0005)"
else
  tail -50 "$B0_LOG" >&2
  fail "B0 — virtio_balloon not bound to slot 4"
fi
fi  # B0 rootfs gate

# ---- B1: spike-and-idle reclaim ----
# Boot a long-running named VM, measure baseline RSS, drive a spike
# through tmpfs (anon pages — not pagecache), free + sync, wait
# REPORT_GRACE seconds for the guest's page-reporting kthread to fire,
# remeasure. A working balloon brings RSS back down (within tolerance);
# without it, the post-spike RSS stays at the high-water mark.
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 ]]; then
  echo "B1: skipped (rootfs lacks vsock-exec)"
else
echo "B1: spike-and-idle reclaim — RSS drops after free-page-reporting fires"
B1_NAME="balloon-smoke-$$"
B1_BG_LOG="$FIXTURE/b1-bg.log"
B1_PID=$(boot_bg "$B1_NAME" "$B1_BG_LOG" --memory 2048 -- \
  /bin/sh -c "/exec-agent & sleep 600")
# B1 runs before the N-series which asserts an empty registry, so
# cleanup MUST remove the registry entry, not just kill the VMM.
# `machinen stop <name>` does both (SIGTERM + writeEntry remove).
cleanup_b1() {
  cli stop "$B1_NAME" >/dev/null 2>&1 || true
  kill -TERM "$B1_PID" 2>/dev/null || true
  wait "$B1_PID" 2>/dev/null || true
}
trap 'cleanup_b1; rm -rf "$FIXTURE"' EXIT

if ! wait_for_vm "$B1_NAME"; then
  tail -60 "$B1_BG_LOG" >&2
  fail "B1 — '$B1_NAME' never appeared in 'machinen ls'"
fi

# Discover VMM pid via the registry.
B1_VMM_PID=$(cli ls 2>/dev/null | awk -v n="$B1_NAME" 'NR>1 && $2==n {print $1}')
if [[ -z "$B1_VMM_PID" ]]; then
  cli ls >&2 || true
  fail "B1 — couldn't find VMM pid for '$B1_NAME'"
fi

# Let post-boot allocations settle before snapshotting baseline.
sleep 3
B1_BASELINE=$(vmm_phys_footprint_mib "$B1_VMM_PID")
echo "  baseline RSS=${B1_BASELINE} MiB (vmm pid $B1_VMM_PID)"

# Drive a 1 GiB spike inside the guest, then free it with rm + sync
# + drop_caches. Writing into a tmpfs mount would be ideal (pure
# anon pages) but the base rootfs doesn't ship one — falling back to
# /tmp on the rootdisk works because ext4 pagecache + drop_caches
# returns the pages to the kernel's free pool, which is exactly
# what free-page-reporting hands back to the host. With ram=2048
# MiB and the kernel reserving ~150 MiB, 1 GiB is well within
# budget but big enough that the RSS delta is unmistakable.
#
# `cli exec` joins post-`--` args with spaces and runs the result
# under `sh -c` in the guest — so we pass the command as one
# already-shell-ready string, no extra `/bin/sh -c` wrapping.
B1_SPIKE_LOG="$FIXTURE/b1-spike.log"
if ! cli exec "$B1_NAME" -- \
  'dd if=/dev/zero of=/tmp/big bs=1M count=1024 status=none && sync && echo SPIKE_DONE' \
  >"$B1_SPIKE_LOG" 2>&1; then
  cat "$B1_SPIKE_LOG" >&2
  fail "B1 — spike workload failed"
fi
# `vmm_phys_footprint_mib` reads the VMM's stats file, which the
# in-VMM sampler thread refreshes every ~500 ms (see stats.zig). The
# 1 GiB spike itself finishes in well under that, so reading the
# stats file the instant `cli exec` returns can catch a sample taken
# mid-spike — the footprint is real, the *sample* just hasn't landed
# yet. Wait two sampler intervals so the post-spike high-water mark
# is guaranteed to be in the file before we read it.
sleep 2
B1_SPIKE=$(vmm_phys_footprint_mib "$B1_VMM_PID")
echo "  post-spike RSS=${B1_SPIKE} MiB"

# A working spike should add at least ~700 MiB (rounding for ext4
# pagecache + kernel internal allocations on top of the 1 GiB tmpfs).
if (( B1_SPIKE - B1_BASELINE < 700 )); then
  fail "B1 — spike only added $(( B1_SPIKE - B1_BASELINE )) MiB; expected ≥700"
fi
pass "spike added $(( B1_SPIKE - B1_BASELINE )) MiB to host RSS"

# Free + sync, then wait for the kernel's reporting thread.
# `page_reporting_period_ms` defaults to 2000; report budget is 16
# 2-MiB blocks per cycle, so a 1 GiB free-run takes a few cycles to
# fully drain. 30s is comfortable.
if ! cli exec "$B1_NAME" -- \
  'rm /tmp/big && sync && echo 3 > /proc/sys/vm/drop_caches && echo FREE_DONE' \
  >"$FIXTURE/b1-free.log" 2>&1; then
  cat "$FIXTURE/b1-free.log" >&2
  fail "B1 — free workload failed"
fi
sleep 30
B1_RECLAIMED=$(vmm_phys_footprint_mib "$B1_VMM_PID")
echo "  post-free + 30s wait RSS=${B1_RECLAIMED} MiB"

# Reclaim won't return RSS to baseline — the guest's still-mapped
# working set (kernel slab, init + exec-agent, ext4 metadata, the
# stage-2 page tables for every page the guest ever touched) all
# stay resident. What we *do* expect: a meaningful drop from the
# post-spike high-water mark, ≥500 MiB out of the 700+ MiB spike.
# A drop below that threshold means the balloon's `madvise` reclaim
# path isn't actually freeing memory — or, on Darwin, that the host
# RSS reader regressed back to `task_basic_info.resident_size` (which
# stays high after `MADV_FREE_REUSABLE` until the kernel reclaims
# under pressure). `vmm_rss_mib` reads `phys_footprint` from the
# VMM's stats file to avoid the latter.
B1_RECLAIMED_DROP=$(( B1_SPIKE - B1_RECLAIMED ))
if (( B1_RECLAIMED_DROP < 500 )); then
  fail "B1 — RSS only dropped ${B1_RECLAIMED_DROP} MiB after reclaim (spike ${B1_SPIKE} → ${B1_RECLAIMED}); expected ≥500"
fi
pass "balloon reclaim: ${B1_RECLAIMED_DROP} MiB returned to host (spike ${B1_SPIKE} → ${B1_RECLAIMED} MiB)"

cleanup_b1
trap 'rm -rf "$FIXTURE"' EXIT
fi  # B1 rootfs gate

# ---- B2: VIRTIO_BALLOON_F_REPORTING is advertised + negotiated ----
# Symmetric guard to B1: B1 proves reclaim *actually drops RSS*; B2
# proves the negotiation that drives reclaim is wired up at the
# device-feature level. Together they catch both halves of a
# regression — code path silently disconnected vs. silently broken.
#
# Why a feature-bit check in addition to B1's behavioural one: B1's
# 30s settling window is workload-dependent and was historically
# flaky on cold runners. A direct read of the guest's negotiated
# `features` bitmap is deterministic and fast, and pins the
# invariant that someone has to consciously change to disable the
# reclaim path.
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 ]]; then
  echo "B2: skipped (rootfs lacks vsock-exec)"
else
echo "B2: guest sees REPORTING bit set on the balloon device"
B2_LOG="$FIXTURE/b2.log"
# /sys/bus/virtio/devices/virtio4/features is a 64-char ASCII bitmap
# of the *negotiated* feature bits — char i = '1' iff bit i is set.
# We read indices 5 (REPORTING) and 32 (VERSION_1) and assert the
# expected pattern. virtio4 is the balloon slot per #263 phase B
# (B0 above checks the device-id binding).
run_timeout 60 node "$CLI" boot -- /bin/sh -c \
  'F=$(cat /sys/bus/virtio/devices/virtio4/features); echo "REPORTING=$(echo "$F" | cut -c6)"; echo "VERSION_1=$(echo "$F" | cut -c33)"' \
  >"$B2_LOG" 2>&1 || true
if grep -q "REPORTING=1" "$B2_LOG" && grep -q "VERSION_1=1" "$B2_LOG"; then
  pass "guest negotiated VERSION_1 + REPORTING"
else
  tail -50 "$B2_LOG" >&2
  fail "B2 — expected REPORTING=1 and VERSION_1=1 in negotiated features"
fi
fi  # B2 rootfs gate

# ---- B3: page-reporting cycle terminates on a --lazy restored VM (#290) ----
# Boot memdirty, snapshot, restore --lazy, then watch the VMM's
# `bytes_reported` counter (cumulative, monotonic). Without the
# in-tree kernel patch
# (`packages/microvm/patches/kernel/0001-mm-page-reporting-skip-merge-with-reported-buddy.patch`)
# the guest kernel's page-reporting workqueue re-reports the same
# physical pages every 2-second cycle indefinitely, because the
# buddy allocator clears the Reported flag during merges; on a
# 1.5 GiB lazy-restored VM we observed `bytes_reported` climbing
# past 12 GiB before hitting the sample horizon. With the patch
# the cycle terminates after a single warm-up sweep (~22 s) and
# `bytes_reported` plateaus.
#
# We assert plateau by sampling twice with a 5-cycle (10 s) gap
# *after* a 30 s settle. A non-terminating cycle would add ~1 GiB
# per cycle to the second sample; we just assert equality, which
# trips on any forward motion at all.
if [[ "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 \
      || "$ROOTFS_SUPPORTS_MEMDIRTY" -eq 0 ]]; then
  echo "B3: skipped (rootfs lacks criu/snapshot/memdirty helpers)"
else
echo "B3: lazy-restored VM's page-reporting cycle reaches steady state"
B3_NAME="lazy-balloon-smoke-$$"
B3_BG_LOG="$FIXTURE/b3-bg.log"
B3_SCRATCH="$FIXTURE/b3-scratch.img"
B3_SNAP_DIR="$FIXTURE/b3-snap"
B3_RESTORE_LOG="$FIXTURE/b3-restore.log"
B3_DIRTY_MIB=128
B3_RAM_MIB=$((B3_DIRTY_MIB + 1024))

truncate -s 4G "$B3_SCRATCH"
B3_PID=$(boot_bg "$B3_NAME" "$B3_BG_LOG" --memory "$B3_RAM_MIB" --snapshot "$B3_SCRATCH" -- \
  /sbin/machinen-memdirty "$B3_DIRTY_MIB")
cleanup_b3() {
  cli stop "$B3_NAME" >/dev/null 2>&1 || true
  kill -TERM "$B3_PID" 2>/dev/null || true
  wait "$B3_PID" 2>/dev/null || true
}
trap 'cleanup_b3; rm -rf "$FIXTURE"' EXIT

if ! wait_for_vm "$B3_NAME"; then
  tail -80 "$B3_BG_LOG" >&2
  fail "B3 — '$B3_NAME' never appeared in 'machinen ls'"
fi

deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  if grep -q "READY mib=$B3_DIRTY_MIB" "$B3_BG_LOG"; then
    break
  fi
  sleep 1
done
if ! grep -q "READY mib=$B3_DIRTY_MIB" "$B3_BG_LOG"; then
  tail -120 "$B3_BG_LOG" >&2
  fail "B3 — memdirty never printed READY mib=$B3_DIRTY_MIB"
fi
sleep 2

if ! cli snapshot "$B3_NAME" "$B3_SNAP_DIR" 2>"$FIXTURE/b3-dump.log"; then
  cat "$FIXTURE/b3-dump.log" >&2
  fail "B3 — 'machinen snapshot' failed"
fi
wait "$B3_PID" 2>/dev/null || true

node "$CLI" restore "$B3_SNAP_DIR" --lazy >"$B3_RESTORE_LOG" 2>&1 &
B3_RESTORE_PID=$!
cleanup_b3_restore() {
  kill -TERM "$B3_RESTORE_PID" 2>/dev/null || true
  wait "$B3_RESTORE_PID" 2>/dev/null || true
}
trap 'cleanup_b3; cleanup_b3_restore; rm -rf "$FIXTURE"' EXIT

B3_FORK_NAME=""
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
  cand=$(cli ls 2>/dev/null | awk -v src="$B3_NAME" 'NR>1 && (index($2, src "/")==1 || index($2, src "~")==1) {print $2; exit}')
  if [[ -n "$cand" ]]; then
    B3_FORK_NAME=$cand
    break
  fi
  sleep 1
done
if [[ -z "$B3_FORK_NAME" ]]; then
  tail -200 "$B3_RESTORE_LOG" >&2
  fail "B3 — restored VM never registered"
fi

B3_FORK_VMM=$(cli ls 2>/dev/null | awk -v n="$B3_FORK_NAME" 'NR>1 && $2==n {print $1}')
if [[ -z "$B3_FORK_VMM" ]]; then
  fail "B3 — couldn't find VMM pid for '$B3_FORK_NAME'"
fi

# Resolve the restored VMM's stats binary path (registry meta records
# `statsPath`). The 24-byte file's first u64 LE is `bytes_reported`,
# which the balloon backend bumps on every reporting cycle. Smoke
# tests pin MACHINEN_REGISTRY_DIR to the fixture so we don't pollute
# ~/.machinen — read the meta from there.
B3_META="$MACHINEN_REGISTRY_DIR/$B3_FORK_VMM/meta.json"
if [[ ! -f "$B3_META" ]]; then
  fail "B3 — registry meta not found at $B3_META (vmm=$B3_FORK_VMM)"
fi
B3_STATS=$(node -e '
  process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).statsPath || "");
' "$B3_META")
if [[ -z "$B3_STATS" || ! -f "$B3_STATS" ]]; then
  fail "B3 — couldn't resolve stats binary for '$B3_FORK_NAME' (vmm=$B3_FORK_VMM)"
fi

read_b3_reported() {
  node -e '
    const buf = require("fs").readFileSync(process.argv[1]);
    process.stdout.write(String(buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : 0));
  ' "$B3_STATS"
}

# Settle: warm-up sweep finished around t=23 in the issue-290
# reproducer at this workload size; 30 s is comfortable.
sleep 30
B3_REPORTED_A=$(read_b3_reported)
echo "  bytes_reported after 30s settle = $B3_REPORTED_A"

# A==0 means REPORTING never fired — likely the feature got silently
# disabled. Catch that explicitly so the equality check below can't
# trivially pass.
if (( B3_REPORTED_A == 0 )); then
  tail -100 "$B3_RESTORE_LOG" >&2
  fail "B3 — bytes_reported == 0 after 30 s; REPORTING didn't fire (#290 regression?)"
fi

# Re-sample across several reporting windows. Healthy kernels can
# trickle a final tiny batch after the first 30 s settle on busy hosts;
# the #290 regression this guards against never plateaus and adds
# hundreds of MiB. Require one stable adjacent sample before passing.
B3_REPORTED_PREV=$B3_REPORTED_A
B3_PLATEAUED=0
for B3_ATTEMPT in 1 2 3 4 5 6; do
  sleep 10
  B3_REPORTED_NEXT=$(read_b3_reported)
  echo "  bytes_reported after +$((B3_ATTEMPT * 10))s gap = $B3_REPORTED_NEXT"
  if (( B3_REPORTED_NEXT == B3_REPORTED_PREV )); then
    B3_PLATEAUED=1
    break
  fi
  B3_REPORTED_PREV=$B3_REPORTED_NEXT
done

if (( B3_PLATEAUED == 0 )); then
  tail -100 "$B3_RESTORE_LOG" >&2
  fail "B3 — bytes_reported still growing on lazy-restored VM ($B3_REPORTED_A → $B3_REPORTED_PREV); kernel page-reporting cycle isn't terminating (#290 regression?)"
fi
pass "lazy-restored VM's bytes_reported plateaued at $B3_REPORTED_PREV bytes (cycle terminated)"

cleanup_b3_restore
cleanup_b3
trap 'rm -rf "$FIXTURE"' EXIT
fi  # B3 rootfs-capability gate

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

# Registry + cli/boot_bg/wait_for_vm helpers are hoisted above the
# B-series — see the "Helpers that B-series and the later sections
# share" block earlier in this script.

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

# machinen exec <name> -- uname -m should return 0 + the selected guest arch.
N2_EXEC_LOG="$FIXTURE/n2-exec.log"
if cli exec "$N2_NAME" -- uname -m >"$N2_EXEC_LOG" 2>&1; then
  if grep -qE "$GUEST_UNAME_RE" "$N2_EXEC_LOG"; then
    pass "'machinen exec $N2_NAME -- uname -m' returned $GUEST_UNAME_LABEL"
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

# ---- N2D: machinen boot --detached — CLI exits 0; VMM keeps running.
# Issue #150 phase 2. Reuses the N2 rootfs-capability gate (we still
# need vsock-exec inside the guest to prove the VMM is alive after
# the CLI returns).
echo "N2D: machinen boot --detached --name worker; CLI exits; exec round-trip"
N2D_NAME="smoke-detached-$$"
N2D_LOG="$FIXTURE/n2d.log"
N2D_LOG_DIR="$FIXTURE/n2d-logs"
mkdir -p "$N2D_LOG_DIR"
# Foreground boot — should return quickly because --detached unrefs
# the VMM after first-guest-byte.
n2d_t0=$SECONDS
if MACHINEN_DETACHED_LOG_DIR="$N2D_LOG_DIR" cli boot \
    --name "$N2D_NAME" --detached \
    -- /bin/sh -c "/exec-agent & sleep 120" >"$N2D_LOG" 2>&1; then
  pass "boot --detached returned 0 in $((SECONDS - n2d_t0))s"
else
  cat "$N2D_LOG" >&2
  fail "N2D — boot --detached exited non-zero"
fi

# Pull the VMM pid from the registry so we can kill it on the way out.
N2D_PID=$(cli ls 2>/dev/null | awk -v n="$N2D_NAME" 'NR>1 && $2==n {print $1}')
cleanup_n2d() {
  [[ -n "${N2D_PID:-}" ]] && kill -TERM "$N2D_PID" 2>/dev/null || true
}
trap 'cleanup_n2d; cleanup_n2; rm -rf "$FIXTURE"' EXIT

if [[ -z "$N2D_PID" ]]; then
  cli ls >&2 || true
  fail "N2D — '$N2D_NAME' missing from 'machinen ls' after detach"
fi
pass "ls shows '$N2D_NAME' (pid $N2D_PID) post-detach"

# Boot snapshot should land at <log-dir>/<pid>.boot.log with content.
N2D_SNAPSHOT="$N2D_LOG_DIR/$N2D_PID.boot.log"
if [[ -s "$N2D_SNAPSHOT" ]]; then
  pass "boot snapshot written to $N2D_SNAPSHOT ($(wc -c <"$N2D_SNAPSHOT") bytes)"
else
  ls -la "$N2D_LOG_DIR" >&2
  fail "N2D — boot snapshot empty or missing at $N2D_SNAPSHOT"
fi

# Live exec proves the VMM survived the CLI exit (the SIGPIPE-ignore
# in main.zig is what keeps it alive once the parent's stderr pipe
# breaks).
N2D_EXEC_LOG="$FIXTURE/n2d-exec.log"
if cli exec "$N2D_NAME" -- uname -m >"$N2D_EXEC_LOG" 2>&1; then
  if grep -qE "$GUEST_UNAME_RE" "$N2D_EXEC_LOG"; then
    pass "post-detach 'exec $N2D_NAME -- uname -m' returned $GUEST_UNAME_LABEL"
  else
    cat "$N2D_EXEC_LOG" >&2
    fail "N2D — post-detach exec stdout missing arch marker"
  fi
else
  cat "$N2D_EXEC_LOG" >&2
  fail "N2D — post-detach 'machinen exec' exited non-zero"
fi
# Don't call cleanup_n2d here — N2S below uses `machinen stop` to
# tear it down and asserts the cleanup actually happened. The EXIT
# trap is still set, so a failure between here and the end of N2S
# still kills the VMM.

# ---- N2S: machinen stop <name> — clean SIGTERM + gc.
# Issue #150 phase 2 PR2. Reuses the N2D-booted detached VM: now
# tear it down via `machinen stop` instead of raw kill, and assert
# both the registry entry and the per-boot artifacts are gone.
echo "N2S: machinen stop $N2D_NAME"
# Snapshot the cleanupPaths we expect gc to nuke. Pull them straight
# from the registry's meta.json — gc has the source of truth.
N2D_META="$MACHINEN_REGISTRY_DIR/$N2D_PID/meta.json"
if [[ ! -s "$N2D_META" ]]; then
  fail "N2S — meta.json missing for pid $N2D_PID"
fi
# `node -p` to extract cleanupPaths reliably without a JSON parser
# in bash. Falls back to empty string if the field is absent.
N2D_CLEANUP_PATHS=$(node -p "JSON.parse(require('fs').readFileSync('$N2D_META','utf8')).cleanupPaths?.join('\\n') ?? ''" 2>/dev/null || true)
# #150 phase 2 PR3: gvproxy is also detached for --detached boots,
# its pid is recorded in the registry, and `machinen stop` should
# SIGTERM it alongside the VMM. Capture it here so we can assert
# it's gone post-stop.
N2D_GVPROXY_PID=$(node -p "JSON.parse(require('fs').readFileSync('$N2D_META','utf8')).gvproxyPid ?? ''" 2>/dev/null || true)

N2S_LOG="$FIXTURE/n2s.log"
if cli stop "$N2D_NAME" >"$N2S_LOG" 2>&1; then
  pass "machinen stop $N2D_NAME exited 0"
else
  cat "$N2S_LOG" >&2
  fail "N2S — machinen stop exited non-zero"
fi

# Registry entry should be gone.
if cli ls 2>/dev/null | grep -q "$N2D_NAME"; then
  cli ls >&2
  fail "N2S — '$N2D_NAME' still listed after machinen stop"
fi
pass "machinen ls no longer lists '$N2D_NAME'"

# Each cleanupPath should now be gone too. Skip the loop body when
# cleanupPaths was empty in the registry (e.g. snapshot: false boots).
if [[ -n "$N2D_CLEANUP_PATHS" ]]; then
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if [[ -e "$path" ]]; then
      fail "N2S — cleanupPath survived gc: $path"
    fi
  done <<<"$N2D_CLEANUP_PATHS"
  pass "machinen stop removed all recorded cleanupPaths"
else
  pass "no cleanupPaths recorded (nothing to verify)"
fi

# gvproxy should be reaped by `machinen stop`. Without PR3 it would
# survive (no pdeathsig in detached mode → orphaned to PID 1, holding
# the qemu/control sockets and any host port forwards).
if [[ -n "$N2D_GVPROXY_PID" ]]; then
  if kill -0 "$N2D_GVPROXY_PID" 2>/dev/null; then
    ps -o pid=,comm=,lstart= -p "$N2D_GVPROXY_PID" >&2 || true
    fail "N2S — gvproxy pid $N2D_GVPROXY_PID still alive after machinen stop"
  fi
  pass "machinen stop reaped gvproxy (pid $N2D_GVPROXY_PID)"
else
  pass "no gvproxy spawned for this VM (nothing to reap)"
fi

# Stop is idempotent — calling it again on a missing name should
# error cleanly, not crash.
N2S_AGAIN_LOG="$FIXTURE/n2s-again.log"
if cli stop "$N2D_NAME" >"$N2S_AGAIN_LOG" 2>&1; then
  cat "$N2S_AGAIN_LOG" >&2
  fail "N2S — second 'stop' on missing name should have failed"
fi
if grep -q "no running VM matched" "$N2S_AGAIN_LOG"; then
  pass "second stop reports 'no running VM matched'"
else
  cat "$N2S_AGAIN_LOG" >&2
  fail "N2S — expected 'no running VM matched' on missing name"
fi

# Already cleaned by `machinen stop`, so cleanup_n2d is a no-op now.
trap 'rm -rf "$FIXTURE"' EXIT

# ---- N2L: machinen boot --detached --mount-live composes; the live
# mount still serves bytes post-detach, and `machinen stop` reaps the
# VM cleanly. Issue #150 phase 3 / #338. The live mount is served by an
# in-VMM virtio-fs device that lives with the VMM, so `--detached`
# carries it across the supervisor exit with no separate helper process.
echo "N2L: machinen boot --detached --mount-live composes; exec reads it; stop reaps"
N2L_NAME="smoke-detached-live-$$"
N2L_LOG="$FIXTURE/n2l.log"
N2L_LOG_DIR="$FIXTURE/n2l-logs"
N2L_SRC="$FIXTURE/n2l-live"
N2L_MARKER="n2l-marker-$$"
mkdir -p "$N2L_SRC" "$N2L_LOG_DIR"
# Seed the marker BEFORE boot so the post-detach exec can read it.
echo "$N2L_MARKER" >"$N2L_SRC/hello.txt"

n2l_t0=$SECONDS
if MACHINEN_DETACHED_LOG_DIR="$N2L_LOG_DIR" cli boot \
    --name "$N2L_NAME" --detached \
    --mount-live "$N2L_SRC:/mnt/live:ro" \
    -- /bin/sh -c "/exec-agent & sleep 120" >"$N2L_LOG" 2>&1; then
  pass "boot --detached --mount-live returned 0 in $((SECONDS - n2l_t0))s"
else
  cat "$N2L_LOG" >&2
  fail "N2L — boot --detached --mount-live exited non-zero"
fi

N2L_PID=$(cli ls 2>/dev/null | awk -v n="$N2L_NAME" 'NR>1 && $2==n {print $1}')
cleanup_n2l() {
  [[ -n "${N2L_PID:-}" ]] && kill -TERM "$N2L_PID" 2>/dev/null || true
}
trap 'cleanup_n2l; rm -rf "$FIXTURE"' EXIT
if [[ -z "$N2L_PID" ]]; then
  cli ls >&2 || true
  fail "N2L — '$N2L_NAME' missing from 'machinen ls' after detach"
fi
pass "detached --mount-live VM registered as '$N2L_NAME' (pid $N2L_PID)"

# Real-traffic check: post-detach exec into the VM and read the
# mounted file. If the virtio-fs device didn't survive the detach,
# this `cat /mnt/live/hello.txt` would surface an I/O error.
N2L_EXEC_LOG="$FIXTURE/n2l-exec.log"
if cli exec "$N2L_NAME" -- cat /mnt/live/hello.txt >"$N2L_EXEC_LOG" 2>&1; then
  if grep -q "$N2L_MARKER" "$N2L_EXEC_LOG"; then
    pass "post-detach 'cat /mnt/live/hello.txt' returned the seeded marker"
  else
    cat "$N2L_EXEC_LOG" >&2
    fail "N2L — post-detach cat output missing marker"
  fi
else
  cat "$N2L_EXEC_LOG" >&2
  fail "N2L — post-detach 'machinen exec ... cat' exited non-zero"
fi

# `machinen stop` should SIGTERM the VMM cleanly.
N2L_STOP_LOG="$FIXTURE/n2l-stop.log"
if cli stop "$N2L_NAME" >"$N2L_STOP_LOG" 2>&1; then
  pass "machinen stop $N2L_NAME exited 0"
else
  cat "$N2L_STOP_LOG" >&2
  fail "N2L — machinen stop exited non-zero"
fi

trap 'rm -rf "$FIXTURE"' EXIT

# ---- N2M: machinen boot --detached --mount; overlay survives parent
# exit, exec reads it post-detach, `machinen stop` reaps the per-VM
# ext4 upper.
# Issue #150 phase 3 (M2). Reuses the N2 rootfs-capability gate.
echo "N2M: machinen boot --detached --mount; overlay survives detach; stop reaps the upper"
N2M_NAME="smoke-detached-mount-$$"
N2M_LOG="$FIXTURE/n2m.log"
N2M_LOG_DIR="$FIXTURE/n2m-logs"
N2M_SRC="$FIXTURE/n2m-src"
N2M_MARKER="n2m-marker-$$"
mkdir -p "$N2M_SRC" "$N2M_LOG_DIR"
echo "$N2M_MARKER" >"$N2M_SRC/hello.txt"

n2m_t0=$SECONDS
if MACHINEN_DETACHED_LOG_DIR="$N2M_LOG_DIR" cli boot \
    --name "$N2M_NAME" --detached \
    --mount "$N2M_SRC:/mnt/m" \
    -- /bin/sh -c "/exec-agent & sleep 120" >"$N2M_LOG" 2>&1; then
  pass "boot --detached --mount returned 0 in $((SECONDS - n2m_t0))s"
else
  cat "$N2M_LOG" >&2
  fail "N2M — boot --detached --mount exited non-zero"
fi

N2M_PID=$(cli ls 2>/dev/null | awk -v n="$N2M_NAME" 'NR>1 && $2==n {print $1}')
cleanup_n2m() {
  [[ -n "${N2M_PID:-}" ]] && kill -TERM "$N2M_PID" 2>/dev/null || true
}
trap 'cleanup_n2m; rm -rf "$FIXTURE"' EXIT
if [[ -z "$N2M_PID" ]]; then
  cli ls >&2 || true
  fail "N2M — '$N2M_NAME' missing from 'machinen ls' after detach"
fi

N2M_META="$MACHINEN_REGISTRY_DIR/$N2M_PID/meta.json"
N2M_UPPER=$(node -p "
  const e = JSON.parse(require('fs').readFileSync('$N2M_META','utf8'));
  (e.mountDisk && e.mountDisk.upperPath) || ''
" 2>/dev/null || true)
if [[ -z "$N2M_UPPER" ]]; then
  cat "$N2M_META" >&2
  fail "N2M — registry meta has no mountDisk.upperPath entry"
fi
if [[ ! -f "$N2M_UPPER" ]]; then
  fail "N2M — per-VM ext4 upper $N2M_UPPER missing on disk before stop"
fi
pass "registry recorded mountDisk.upperPath: $N2M_UPPER"

# Real-traffic check: post-detach exec into the VM and read the seeded
# file through the overlay. The squashfs lower + ext4 upper are kernel
# block devices fd-passed at spawn, so if anything in the supervisor
# accidentally held them, this exec would surface EIO.
N2M_EXEC_LOG="$FIXTURE/n2m-exec.log"
if cli exec "$N2M_NAME" -- cat /mnt/m/hello.txt >"$N2M_EXEC_LOG" 2>&1; then
  if grep -q "$N2M_MARKER" "$N2M_EXEC_LOG"; then
    pass "post-detach 'cat /mnt/m/hello.txt' returned the seeded marker"
  else
    cat "$N2M_EXEC_LOG" >&2
    fail "N2M — post-detach cat output missing marker"
  fi
else
  cat "$N2M_EXEC_LOG" >&2
  fail "N2M — post-detach 'machinen exec ... cat' exited non-zero"
fi

# `machinen stop` should SIGTERM the VMM and reap the per-VM upper.
N2M_STOP_LOG="$FIXTURE/n2m-stop.log"
if cli stop "$N2M_NAME" >"$N2M_STOP_LOG" 2>&1; then
  pass "machinen stop $N2M_NAME exited 0"
else
  cat "$N2M_STOP_LOG" >&2
  fail "N2M — machinen stop exited non-zero"
fi

if [[ -e "$N2M_UPPER" ]]; then
  ls -la "$N2M_UPPER" >&2 || true
  fail "N2M — per-VM ext4 upper $N2M_UPPER still on disk after stop"
fi
pass "machinen stop reaped the per-VM ext4 upper"

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
tar -xzf "$ROOTFS_TAR" -C "$N5_STAGE"
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
if grep -q "Version:" "$P1_LOG"; then
  pass "criu runs inside the base rootfs"
else
  tail -50 "$P1_LOG" >&2
  fail "P1 — criu --version did not print a Version: line"
fi

# ---- P4: portable proof workload prints deterministic state markers (#379) ----
echo "P4: machinen boot -- mounted portable proof checkpoint + restore loader"
P4_LOG="$FIXTURE/p4-portable-proof.log"
P4_OUT="$FIXTURE/p4-portable-proof-out"
mkdir -p "$P4_OUT"
echo "portable-resource-marker" >"$P4_OUT/resource.txt"
case "$GUEST_ARCH" in
  arm64) P4_ZIG_TARGET="aarch64-linux-musl" ;;
  amd64) P4_ZIG_TARGET="x86_64-linux-musl" ;;
  *) fail "P4 — unknown guest arch $GUEST_ARCH" ;;
esac
zig cc "$ROOT/packages/microvm/test-fixtures/proof-assets/portable-proof-workload.c" \
  -I "$ROOT/packages/microvm/test-fixtures/proof-assets" \
  -target "$P4_ZIG_TARGET" \
  -static \
  -pthread \
  -Os \
  -o "$P4_OUT/machinen-portable-proof"
cp "$ROOT/packages/microvm/test-fixtures/proof-assets/portable-restore-loader.sh" \
  "$P4_OUT/machinen-portable-restore-proof"
chmod +x "$P4_OUT/machinen-portable-proof" "$P4_OUT/machinen-portable-restore-proof"
run_timeout 60 node "$CLI" boot \
  --mount-live "$P4_OUT:/mnt/portable-proof" \
  -- /bin/sh -c '/mnt/portable-proof/machinen-portable-proof --restore-proof --resource-file /mnt/portable-proof/resource.txt --emit-bundle /mnt/portable-proof/bundle && /mnt/portable-proof/machinen-portable-restore-proof /mnt/portable-proof/bundle' \
  >"$P4_LOG" 2>&1 || true
if node "$ROOT/scripts/portable-proof-compare.mjs" --expect-arch "$GUEST_ARCH" --require-restore --require-continue --bundle-dir "$P4_OUT/bundle" "$P4_LOG" >/dev/null; then
  pass "portable proof workload emitted a bundle and the restore loader replayed it"
else
  node "$ROOT/scripts/portable-proof-compare.mjs" --expect-arch "$GUEST_ARCH" --require-restore --require-continue --bundle-dir "$P4_OUT/bundle" "$P4_LOG" >&2 || true
  tail -50 "$P4_LOG" >&2
  fail "P4 — portable proof markers or bundle did not validate"
fi

# ---- P2: virtio_blk + vsock (+ arm64 nested KVM config) visible at boot ----
# Drivers are now compiled into the kernel (#119), so /proc/modules is
# empty. Instead, prove they're live: /sys/class/block/vda exists once
# virtio_blk has bound, and /proc/net/protocols lists AF_VSOCK once
# vsock + virtio_vsock are linked in. On arm64, also assert CONFIG_KVM=y
# so a nested-enabled L1 can expose /dev/kvm without loading modules (#271).
P2_LOG="$FIXTURE/p2.log"
if [[ "$GUEST_ARCH" == "arm64" ]]; then
  echo "P2: machinen boot -- virtio_blk + AF_VSOCK + CONFIG_KVM"
  run_timeout 60 node "$CLI" boot -- /bin/sh -c \
    'ls -d /sys/class/block/vda 2>/dev/null && grep -E "^AF_VSOCK " /proc/net/protocols && gzip -dc /proc/config.gz | grep -E "^CONFIG_KVM=y"' \
    >"$P2_LOG" 2>&1 || true
  if grep -q "/sys/class/block/vda" "$P2_LOG" && grep -qE "(^|\] )AF_VSOCK " "$P2_LOG" && grep -q "^CONFIG_KVM=y" "$P2_LOG"; then
    pass "kernel has virtio_blk + vsock + KVM built in (/dev/vda, AF_VSOCK, CONFIG_KVM=y)"
  else
    tail -50 "$P2_LOG" >&2
    fail "P2 — expected /sys/class/block/vda, AF_VSOCK, and CONFIG_KVM=y"
  fi
else
  echo "P2: machinen boot -- virtio_blk + AF_VSOCK"
  run_timeout 60 node "$CLI" boot -- /bin/sh -c \
    'ls -d /sys/class/block/vda 2>/dev/null && grep -E "^AF_VSOCK " /proc/net/protocols' \
    >"$P2_LOG" 2>&1 || true
  if grep -q "/sys/class/block/vda" "$P2_LOG" && grep -qE "(^|\] )AF_VSOCK " "$P2_LOG"; then
    pass "kernel has virtio_blk + vsock built in (/dev/vda + AF_VSOCK live)"
  else
    tail -50 "$P2_LOG" >&2
    fail "P2 — expected /sys/class/block/vda and AF_VSOCK"
  fi
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

echo
echo "all smoke tests passed"
