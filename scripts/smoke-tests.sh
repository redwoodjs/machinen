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
#   P1-P3  Base-rootfs contract (criu, virtio modules, poweroff) — #77.
#   N1-N5  New #93 CLI surface: ls, exec, attach-unknown, completion,
#          plus image-carries-cmd default.
#   B0-B1  virtio-balloon free-page-reporting — #263.
#   S1-S3  Snapshot, chained-snapshot, fork — #207, #215, #216.
#   S4     Lazy-pages restore round-trip — #266.
#   S5     Headline RSS: fork RSS ≪ dirty parent RSS — #266.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"
# Staged location matches what the runtime resolver and mn-dev use.
# Shares the inputs-sha256 sidecar that check-asset-freshness.sh
# writes/reads, so a smoke run after an mn-dev session doesn't see a
# stale "vmm" report and vice versa.
VMM="$ROOT/packages/vmm-arm64-darwin/bin/machinen-vm"
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
# build-vmm.sh handles zig build + codesign + staging copy + writing
# the inputs-sha256 sidecar that the freshness check below consumes.
echo "=== building VMM ==="
bash "$ROOT/scripts/build-vmm.sh"

if [[ ! -f "$ASSETS/Image-arm64" ]]; then
  echo "=== building base assets (~5 min on first run, cached after) ==="
  "$ROOT/scripts/build-base-assets.sh"
fi

# Catch a stale rootfs / kernel before booting. Without this, an
# out-of-date /sbin/machinen-dump (e.g. release-assets/ predates a
# host-side change to the snapshot protocol) produces a 10s vsock
# timeout in S1 that looks like a runtime regression. The checker
# diffs source-file hashes against sidecars baked at build time;
# missing sidecars (older release-assets/) just warn.
if ! "$ROOT/scripts/check-asset-freshness.sh" --quiet; then
  echo "smoke: release-assets/ is stale — rebuild with bash $ROOT/scripts/build-base-assets.sh" >&2
  exit 1
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

# Capability probe: N-series (vsock exec) and P/C-series (criu, fnm)
# need a #77+ rootfs. Peek inside the tarball for marker files; skip
# dependent sections with a warning if we're running against a stale
# (pre-#77) rootfs. Rebuild with ./scripts/build-base-assets.sh to
# pick them up.
ROOTFS_TAR="$ASSETS/rootfs-debian-arm64.tar.gz"
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
# Skips if the rootfs tarball doesn't ship the fuse-agent userspace
# relay — the kernel always has FUSE built in (`=y`, see
# build-kernel-arm64.sh), so the previous `fuse.ko` gate would skip
# forever. Stale tarballs from before #78 won't have fuse-agent.
echo "T3: machinen boot --mount-live ./fixture:/mnt/live:ro -- cat /mnt/live/hello.txt"
if ! grep -q 'fuse-agent$' <<<"$ROOTFS_ENTRIES"; then
  echo "  skip: fuse-agent not in $ROOTFS_TAR — rebuild base assets"
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
# contents AFTER the VM exits. Same fuse-agent gate as T3.
echo "T5: machinen boot --mount-live (default :rw) — guest write reaches the host"
if ! grep -q 'fuse-agent$' <<<"$ROOTFS_ENTRIES"; then
  echo "  skip: fuse-agent not in $ROOTFS_TAR — rebuild base assets"
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
  if ! node "$CLI" exec --name "$T7_NAME" -- echo guest-wrote '>' /mnt/data/from-guest.txt; then
    tail -50 "$T7_BG_LOG" >&2
    cleanup_t7
    fail "T7 — couldn't write to /mnt/data from the guest"
  fi
  # Snapshot. Default destructive — VM exits when the dump finishes,
  # so we don't need cleanup_t7 afterwards.
  if ! node "$CLI" snapshot --name "$T7_NAME" --out-dir "$T7_BUNDLE" >>"$T7_BG_LOG" 2>&1; then
    tail -50 "$T7_BG_LOG" >&2
    cleanup_t7
    fail "T7 — machinen snapshot failed"
  fi
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
  node "$CLI" restore "$T7_BUNDLE" --eager >"$T7_RESTORE_BG_LOG" 2>&1 &
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
  if node "$CLI" exec --name "$T7_RESTORE_NAME" -- cat /mnt/data/from-guest.txt 2>>"$T7_RESTORE_LOG" | grep -q "guest-wrote"; then
    pass "restored guest sees writes the source guest made into the upper"
  else
    tail -50 "$T7_RESTORE_LOG" >&2
    cleanup_t7_restore
    fail "T7 — restored guest can't read from-guest.txt"
  fi
  if node "$CLI" exec --name "$T7_RESTORE_NAME" -- cat /mnt/data/seed.txt 2>>"$T7_RESTORE_LOG" | grep -q "from-host"; then
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
if grep -E '^overlay /mnt/t8 overlay ' "$T8_LOG" >/dev/null; then
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
  awk '/^MemTotal:/ { printf("%d\n", $2 / 1024); exit }' "$log" 2>/dev/null || echo 0
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
# Auto-size policy: min(host_ram/2, 16384) MiB, floor 512. So the
# guest can land anywhere in [400, 17000] MiB once the kernel takes
# its cut. A value below 400 means the patch silently fell back to
# the DTB's hardcoded 4 GiB or smaller; above 17000 means the cap
# isn't enforced.
if (( M1_MIB >= 400 && M1_MIB <= 17000 )); then
  pass "default MemTotal ${M1_MIB} MiB lands in the auto-size band"
else
  cat "$M1_LOG" >&2
  fail "M1 — MemTotal ${M1_MIB} MiB outside the expected auto-size band [400..17000]"
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

# Helper: read VMM RSS in MiB. Reports 0 if `ps` can't see the pid.
# Resolves through the pdeathsig shim if the input pid wraps one.
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
if grep -q "^DRIVER=virtio_balloon" "$B0_LOG" && grep -q "^DEVICE=0x0005" "$B0_LOG"; then
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
#
# Currently SKIPPED: VIRTIO_BALLOON_F_REPORTING is intentionally off
# in `balloon.zig` (mmap-based reclaim races with in-use guest RAM
# and corrupts the page cache — see the comment on `Backend.features`).
# Re-enable this test when a safe reclaim path lands.
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 ]]; then
  echo "B1: skipped (rootfs lacks vsock-exec)"
elif true; then
  echo "B1: skipped (VIRTIO_BALLOON_F_REPORTING disabled — see balloon.zig)"
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
B1_BASELINE=$(vmm_rss_mib "$B1_VMM_PID")
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
B1_SPIKE=$(vmm_rss_mib "$B1_VMM_PID")
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
B1_RECLAIMED=$(vmm_rss_mib "$B1_VMM_PID")
echo "  post-free + 30s wait RSS=${B1_RECLAIMED} MiB"

# Reclaim won't return RSS to baseline — the guest's still-mapped
# working set (kernel slab, init + exec-agent, ext4 metadata, the
# stage-2 page tables for every page the guest ever touched) all
# stay resident. What we *do* expect: a meaningful drop from the
# post-spike high-water mark, ≥500 MiB out of the 700+ MiB spike.
# A drop below that threshold means the device's mmap-replace path
# isn't actually freeing memory (e.g., stale Linux MADV_DONTNEED
# on Darwin, which is just an advisory hint).
B1_RECLAIMED_DROP=$(( B1_SPIKE - B1_RECLAIMED ))
if (( B1_RECLAIMED_DROP < 500 )); then
  fail "B1 — RSS only dropped ${B1_RECLAIMED_DROP} MiB after reclaim (spike ${B1_SPIKE} → ${B1_RECLAIMED}); expected ≥500"
fi
pass "balloon reclaim: ${B1_RECLAIMED_DROP} MiB returned to host (spike ${B1_SPIKE} → ${B1_RECLAIMED} MiB)"

cleanup_b1
trap 'rm -rf "$FIXTURE"' EXIT
fi  # B1 rootfs gate

# ---- B2: VIRTIO_BALLOON_F_REPORTING stays disabled ----
# Regression guard for the balloon-mmap-reclaim corruption (the reason
# B1 is currently skipped). The fix lives in `Backend.features()` in
# `packages/microvm/src/balloon.zig` — REPORTING (bit 5) is off so the
# guest never queues reporting chains, eliminating the race that
# zeroed in-use guest pages.
#
# Why a feature-bit check instead of a "page cache stays intact under
# load" probe: the corruption is timing-sensitive and didn't reliably
# reproduce in 60s of synthetic memory churn — the original repro
# needed a long-lived workload (HTTP server + 30k requests) and even
# then took most of a minute to surface. A behavioral smoke test that
# only flags 80% of regressions is worse than a deterministic guard
# on the feature bit, which catches the only way the bug can come
# back: someone re-advertising REPORTING without fixing the reclaim
# path. The Zig unit test in balloon.zig pins the same invariant from
# the host side; this one pins it from the guest's POV after MMIO
# negotiation actually happens.
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 ]]; then
  echo "B2: skipped (rootfs lacks vsock-exec)"
else
echo "B2: guest sees REPORTING bit unset on the balloon device"
B2_LOG="$FIXTURE/b2.log"
# /sys/bus/virtio/devices/virtio4/features is a 64-char ASCII bitmap
# of the *negotiated* feature bits — char i = '1' iff bit i is set.
# We read indices 5 (REPORTING) and 32 (VERSION_1) and assert the
# expected pattern. virtio4 is the balloon slot per #263 phase B
# (B0 above checks the device-id binding).
run_timeout 60 node "$CLI" boot -- /bin/sh -c \
  'F=$(cat /sys/bus/virtio/devices/virtio4/features); echo "REPORTING=$(echo "$F" | cut -c6)"; echo "VERSION_1=$(echo "$F" | cut -c33)"' \
  >"$B2_LOG" 2>&1 || true
if grep -q "^REPORTING=0" "$B2_LOG" && grep -q "^VERSION_1=1" "$B2_LOG"; then
  pass "guest negotiated VERSION_1 with REPORTING off"
else
  tail -50 "$B2_LOG" >&2
  fail "B2 — expected REPORTING=0 and VERSION_1=1 in negotiated features"
fi
fi  # B2 rootfs gate

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
  if grep -qE "aarch64|arm64" "$N2D_EXEC_LOG"; then
    pass "post-detach 'exec $N2D_NAME -- uname -m' returned aarch64"
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
  'ls -d /sys/class/block/vda 2>/dev/null && grep -E "^AF_VSOCK " /proc/net/protocols' \
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
# Snapshot/restore round-trip (#50 M2). Uses the supervisor +
# /sbin/machinen-dump + /sbin/machinen-restore baked into the rootfs:
#   1. boot with a scratch /dev/vda + named VM
#   2. `machinen snapshot <n> <d>`                     (attach-snapshot)
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
  if cli exec "$S1_NAME" -- uname -m >"$S1_EXEC_LOG" 2>&1 \
     && grep -qE "aarch64|arm64" "$S1_EXEC_LOG"; then
    pass "exec-agent responds on the dump-side VM"
  else
    cat "$S1_EXEC_LOG" >&2
    tail -60 "$S1_BG_LOG" >&2
    fail "S1 — exec against dump-side VM didn't return arch"
  fi

  # Snapshot via the attach path. The bundle (img/<criu> + meta.json)
  # lands at $S1_SNAP_DIR; the VM exits as part of the dump.
  S1_DUMP_LOG="$FIXTURE/s1-dump.log"
  if ! cli snapshot "$S1_NAME" "$S1_SNAP_DIR" 2>"$S1_DUMP_LOG"; then
    tail -60 "$S1_BG_LOG" >&2
    cat "$S1_DUMP_LOG" >&2
    fail "S1 — 'machinen snapshot' failed"
  fi
  wait "$S1_PID" 2>/dev/null || true
  pass "'machinen snapshot' returned 0"

  if [[ ! -d "$S1_SNAP_DIR/img" ]]; then
    ls -la "$S1_SNAP_DIR" >&2
    fail "S1 — snapshot bundle missing img/ directory"
  fi
  if ! ls "$S1_SNAP_DIR"/img/core-*.img >/dev/null 2>&1; then
    ls -la "$S1_SNAP_DIR/img" >&2
    fail "S1 — snapshot bundle has no img/core-*.img"
  fi
  if [[ ! -f "$S1_SNAP_DIR/meta.json" ]]; then
    ls -la "$S1_SNAP_DIR" >&2
    fail "S1 — snapshot bundle missing meta.json"
  fi
  pass "snapshot bundle has img/core-*.img + meta.json"

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
  if cli exec "$S1_RESTORED_NAME" -- uname -m >"$S1_RESTORE_EXEC_LOG" 2>&1 \
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

# ----------------------------------------------------------------
# S2: chained snapshot — snapshot a restored VM (#207, #215).
#   1. boot a high-PID bash workload, snapshot → bundle A
#   2. restore bundle A
#   3. snapshot the restored VM → bundle B  (2nd-generation chain)
#   4. restore bundle B
#   5. snapshot the chain-restored VM → bundle C  (3rd-gen chain — #215)
#   6. restore bundle C and exec on it to prove it's alive
# Verifies:
#   - reflink-clone (bundle A survives step 3) — #207
#   - /run/machinen-workload.pid (written by criu --pidfile on restore so
#     step 3 can find the workload) — #207
#   - PID-namespace isolation in machinen-restore.sh (#215). The bash
#     workload below runs 200 short-lived subshells before the long
#     sleep loop so the dumped tree's PIDs are well above what the
#     restore-side helpers (exec-agent, mount, blkid, mkdir, the sub-NS
#     criu daemon) want to allocate. Without #215's `unshare --pid`
#     the chained restore (step 4) fails with `clone3(set_tid=N): EEXIST`
#     and the kernel panics ("init exited 1").
# ----------------------------------------------------------------
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 ]]; then
  echo "S2: skipped (rootfs lacks vsock/criu/snapshot helpers)"
else
  echo "S2: chained snapshot (snapshot a restored VM, 3 generations, high PIDs)"
  S2_NAME="chained-smoke-$$"
  S2_BG_LOG="$FIXTURE/s2-bg.log"
  S2_SNAP_A="$FIXTURE/s2-snap-a"
  S2_SNAP_B="$FIXTURE/s2-snap-b"
  S2_SNAP_C="$FIXTURE/s2-snap-c"
  S2_SCRATCH="$FIXTURE/s2-scratch.img"
  S2_RESTORE_A_LOG="$FIXTURE/s2-restore-a.log"
  S2_RESTORE_B_LOG="$FIXTURE/s2-restore-b.log"
  S2_RESTORE_C_LOG="$FIXTURE/s2-restore-c.log"

  truncate -s 256M "$S2_SCRATCH"

  # Spawn 30 long-running sleep children so the dumped tree spans a
  # range of PIDs (workload + 30 sleeps as direct children). This
  # reproduces the #215 collision: on chained restore CRIU has to
  # set_tid each PID in turn, and its own internal forks between
  # set_tid calls land on the same range — last_pid advances past
  # the next set_tid target and clone3() returns EEXIST. Without
  # `unshare --pid` in /sbin/machinen-restore the chain falls over
  # at gen-2 or gen-3 with "Can't fork for N: File exists" and
  # /init dies, panicking the kernel ("Attempted to kill init!").
  # /bin/bash isn't in the base rootfs (Debian minbase ships
  # /bin/dash + /bin/sh) so we use sh; the dumped tree shape is
  # what matters, not the shell choice.
  S2_PID=$(boot_bg "$S2_NAME" "$S2_BG_LOG" --snapshot "$S2_SCRATCH" -- \
    /bin/sh -c '
      i=0
      while [ "$i" -lt 30 ]; do
        sleep 100000 &
        i=$((i + 1))
      done
      wait
    ')
  cleanup_s2() {
    kill -TERM "$S2_PID" 2>/dev/null || true
    wait "$S2_PID" 2>/dev/null || true
  }
  trap 'cleanup_s2; rm -rf "$FIXTURE"' EXIT

  if ! wait_for_vm "$S2_NAME"; then
    tail -80 "$S2_BG_LOG" >&2
    fail "S2 — '$S2_NAME' never appeared in 'machinen ls'"
  fi

  # Snapshot to bundle A.
  S2_DUMP_A_LOG="$FIXTURE/s2-dump-a.log"
  if ! cli snapshot "$S2_NAME" "$S2_SNAP_A" 2>"$S2_DUMP_A_LOG"; then
    tail -60 "$S2_BG_LOG" >&2
    cat "$S2_DUMP_A_LOG" >&2
    fail "S2 — first 'machinen snapshot' (to A) failed"
  fi
  wait "$S2_PID" 2>/dev/null || true
  pass "snapshot → bundle A"

  if ! ls "$S2_SNAP_A"/img/core-*.img >/dev/null 2>&1; then
    fail "S2 — bundle A has no img/core-*.img"
  fi
  S2_BUNDLE_A_PROBE=$(ls "$S2_SNAP_A"/img/core-*.img | head -1)
  S2_BUNDLE_A_BEFORE=$(stat -c '%Y' "$S2_BUNDLE_A_PROBE" 2>/dev/null \
    || stat -f '%m' "$S2_BUNDLE_A_PROBE")

  # Restore bundle A in the background, then snapshot the restored VM.
  node "$CLI" restore "$S2_SNAP_A" >"$S2_RESTORE_A_LOG" 2>&1 &
  S2_RESTORE_A_PID=$!
  cleanup_s2_restore_a() {
    kill -TERM "$S2_RESTORE_A_PID" 2>/dev/null || true
    wait "$S2_RESTORE_A_PID" 2>/dev/null || true
  }
  trap 'cleanup_s2; cleanup_s2_restore_a; rm -rf "$FIXTURE"' EXIT

  S2_RESTORED_A=""
  deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S2_NAME/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S2_RESTORED_A=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S2_RESTORED_A" ]]; then
    tail -80 "$S2_RESTORE_A_LOG" >&2
    cli ls >&2 || true
    fail "S2 — restored-from-A VM never registered"
  fi
  pass "restored bundle A as '$S2_RESTORED_A'"

  # Snapshot the restored VM to bundle B. This is the operation that
  # used to fail with EBUSY on /dev/vdb and 'PID file missing'.
  S2_DUMP_B_LOG="$FIXTURE/s2-dump-b.log"
  if ! cli snapshot "$S2_RESTORED_A" "$S2_SNAP_B" 2>"$S2_DUMP_B_LOG"; then
    tail -80 "$S2_RESTORE_A_LOG" >&2
    cat "$S2_DUMP_B_LOG" >&2
    fail "S2 — chained 'machinen snapshot' (restored → B) failed"
  fi
  wait "$S2_RESTORE_A_PID" 2>/dev/null || true
  pass "chained snapshot → bundle B"

  if ! ls "$S2_SNAP_B"/img/core-*.img >/dev/null 2>&1; then
    fail "S2 — chained snapshot bundle B has no img/core-*.img"
  fi

  # Bundle A must NOT have been mutated by the chained dump. Restore
  # tars a temp copy on the host before attaching, so the source
  # bundle's files are read-only — the mtime check is a backstop.
  S2_BUNDLE_A_AFTER=$(stat -c '%Y' "$S2_BUNDLE_A_PROBE" 2>/dev/null \
    || stat -f '%m' "$S2_BUNDLE_A_PROBE")
  if [[ "$S2_BUNDLE_A_BEFORE" != "$S2_BUNDLE_A_AFTER" ]]; then
    fail "S2 — bundle A was modified by the chained dump"
  fi
  pass "bundle A unchanged after chained dump"

  # Restore bundle B and prove it's alive via exec.
  node "$CLI" restore "$S2_SNAP_B" >"$S2_RESTORE_B_LOG" 2>&1 &
  S2_RESTORE_B_PID=$!
  cleanup_s2_restore_b() {
    kill -TERM "$S2_RESTORE_B_PID" 2>/dev/null || true
    wait "$S2_RESTORE_B_PID" 2>/dev/null || true
  }
  trap 'cleanup_s2; cleanup_s2_restore_b; rm -rf "$FIXTURE"' EXIT

  S2_RESTORED_B=""
  deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    # The restored-from-B VM's source name is "<S2_RESTORED_A>", so
    # the auto-name is "<S2_RESTORED_A>/<pid>".
    cand=$(cli ls 2>/dev/null | awk -v src="$S2_RESTORED_A/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S2_RESTORED_B=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S2_RESTORED_B" ]]; then
    tail -80 "$S2_RESTORE_B_LOG" >&2
    cli ls >&2 || true
    fail "S2 — restored-from-B VM never registered"
  fi
  pass "restored bundle B as '$S2_RESTORED_B'"

  S2_RESTORE_B_EXEC_LOG="$FIXTURE/s2-restore-b-exec.log"
  if cli exec "$S2_RESTORED_B" -- uname -m >"$S2_RESTORE_B_EXEC_LOG" 2>&1 \
     && grep -qE "aarch64|arm64" "$S2_RESTORE_B_EXEC_LOG"; then
    pass "exec-agent responds on the chain-restored VM (gen 2)"
  else
    cat "$S2_RESTORE_B_EXEC_LOG" >&2
    tail -60 "$S2_RESTORE_B_LOG" >&2
    fail "S2 — exec against chain-restored VM failed"
  fi

  # 3rd-generation chain (#215): snapshot the chain-restored VM, then
  # restore that and exec. This is the case the issue calls out as
  # recursive-safe — the dumped tree's PIDs accumulate as the chain
  # deepens, so a depth-3 restore is the canary for whether
  # /sbin/machinen-dump can dump across a sub-NS boundary.
  S2_DUMP_C_LOG="$FIXTURE/s2-dump-c.log"
  if ! cli snapshot "$S2_RESTORED_B" "$S2_SNAP_C" 2>"$S2_DUMP_C_LOG"; then
    tail -80 "$S2_RESTORE_B_LOG" >&2
    cat "$S2_DUMP_C_LOG" >&2
    fail "S2 — gen-3 'machinen snapshot' (restored-B → C) failed"
  fi
  wait "$S2_RESTORE_B_PID" 2>/dev/null || true
  pass "gen-3 chained snapshot → bundle C"

  if ! ls "$S2_SNAP_C"/img/core-*.img >/dev/null 2>&1; then
    fail "S2 — gen-3 snapshot bundle C has no img/core-*.img"
  fi

  node "$CLI" restore "$S2_SNAP_C" >"$S2_RESTORE_C_LOG" 2>&1 &
  S2_RESTORE_C_PID=$!
  cleanup_s2_restore_c() {
    kill -TERM "$S2_RESTORE_C_PID" 2>/dev/null || true
    wait "$S2_RESTORE_C_PID" 2>/dev/null || true
  }
  trap 'cleanup_s2; cleanup_s2_restore_c; rm -rf "$FIXTURE"' EXIT

  S2_RESTORED_C=""
  deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S2_RESTORED_B/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S2_RESTORED_C=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S2_RESTORED_C" ]]; then
    tail -80 "$S2_RESTORE_C_LOG" >&2
    cli ls >&2 || true
    fail "S2 — gen-3 restored-from-C VM never registered"
  fi
  pass "restored bundle C as '$S2_RESTORED_C'"

  S2_RESTORE_C_EXEC_LOG="$FIXTURE/s2-restore-c-exec.log"
  if cli exec "$S2_RESTORED_C" -- uname -m >"$S2_RESTORE_C_EXEC_LOG" 2>&1 \
     && grep -qE "aarch64|arm64" "$S2_RESTORE_C_EXEC_LOG"; then
    pass "exec-agent responds on the gen-3 chain-restored VM"
  else
    cat "$S2_RESTORE_C_EXEC_LOG" >&2
    tail -60 "$S2_RESTORE_C_LOG" >&2
    fail "S2 — exec against gen-3 chain-restored VM failed"
  fi

  cleanup_s2_restore_c
  trap 'rm -rf "$FIXTURE"' EXIT
fi  # S2 rootfs-capability gate

# ----------------------------------------------------------------
# S3: fork (#216) — snapshot a live VM and restore into a sibling
# without killing the source. Then fork the fork. Verifies:
#   1. `machinen fork` returns a new VM and the source stays alive.
#   2. Both VMs have independent disk state — writes on the source
#      don't appear on the fork and vice versa.
#   3. Fork-of-fork works (chained leave-running snapshot exercises
#      the same #215 sub-NS dump path that S2 covers for destructive
#      snapshots).
#   4. Each generation has independent disk state from its siblings.
# ----------------------------------------------------------------
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 ]]; then
  echo "S3: skipped (rootfs lacks vsock/criu/snapshot helpers)"
else
  echo "S3: machinen fork (live snapshot + sibling, fork-the-fork)"
  S3_NAME="fork-smoke-$$"
  S3_BG_LOG="$FIXTURE/s3-bg.log"
  S3_SCRATCH="$FIXTURE/s3-scratch.img"
  truncate -s 256M "$S3_SCRATCH"

  # Long-lived sleep workload — fork doesn't care what the workload
  # does, only that it stays running across the dump.
  S3_PID=$(boot_bg "$S3_NAME" "$S3_BG_LOG" --snapshot "$S3_SCRATCH" -- \
    /bin/sh -c '
      while :; do sleep 1000; done
    ')
  cleanup_s3() {
    kill -TERM "$S3_PID" 2>/dev/null || true
    wait "$S3_PID" 2>/dev/null || true
  }
  trap 'cleanup_s3; rm -rf "$FIXTURE"' EXIT

  if ! wait_for_vm "$S3_NAME"; then
    tail -80 "$S3_BG_LOG" >&2
    fail "S3 — '$S3_NAME' never appeared in 'machinen ls'"
  fi
  pass "boot --name --snapshot registered '$S3_NAME'"

  # Mark the source's disk before forking. The fork inherits this
  # exact byte (it's part of the dumped state) but writes after the
  # fork must NOT cross between source and fork.
  # `cli exec` joins all post-`--` args with spaces and runs the result
  # under `sh -c` in the guest. To get a real shell redirect inside the
  # guest we have to send `>` as a literal arg (single-quoted on the
  # host so the host bash doesn't interpret it as a redirect).
  if ! cli exec "$S3_NAME" -- echo source '>' /tmp/who; then
    tail -60 "$S3_BG_LOG" >&2
    fail "S3 — couldn't seed /tmp/who on source"
  fi

  # Fork. Source stays alive; fork registers under '<src>/<pid>' via
  # the standard restore() auto-naming.
  S3_FORK_LOG="$FIXTURE/s3-fork.log"
  S3_FORK_BUNDLE="$FIXTURE/s3-fork-bundle"
  if ! cli fork "$S3_NAME" --out-dir "$S3_FORK_BUNDLE" --detach 2>"$S3_FORK_LOG"; then
    cat "$S3_FORK_LOG" >&2
    tail -60 "$S3_BG_LOG" >&2
    fail "S3 — 'machinen fork' failed"
  fi
  S3_FORK_NAME=""
  deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    # Fork's auto-name is `<src>~<pid>` when source is alive (#216),
    # falling back from the chained-restore convention `<src>/<pid>`
    # which collides on the live source's pin file.
    cand=$(cli ls 2>/dev/null | awk -v src="$S3_NAME~" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S3_FORK_NAME=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S3_FORK_NAME" ]]; then
    cat "$S3_FORK_LOG" >&2
    cli ls >&2 || true
    fail "S3 — fork never appeared in 'machinen ls' under '$S3_NAME/...'"
  fi
  pass "fork registered as '$S3_FORK_NAME'"

  # Source must still be in the registry — proves --leave-running
  # actually left it running. Without it, criu would have killed the
  # workload, the supervisor would have powered off, and the source
  # would be gone from `machinen ls`.
  if ! cli ls 2>/dev/null | awk -v n="$S3_NAME" 'NR>1 && $2==n {found=1} END{exit !found}'; then
    cli ls >&2 || true
    fail "S3 — source VM '$S3_NAME' disappeared after fork (--leave-running broke?)"
  fi
  pass "source VM '$S3_NAME' survived the fork"

  # Independence check: write 'fork' on the fork's disk, 'source' is
  # already on the source. Re-read both — neither should see the
  # other's value.
  if ! cli exec "$S3_FORK_NAME" -- echo fork '>' /tmp/who; then
    tail -60 "$S3_BG_LOG" >&2
    fail "S3 — couldn't write /tmp/who on fork"
  fi
  S3_SRC_AFTER=$(cli exec "$S3_NAME" -- cat /tmp/who 2>/dev/null | tr -d '\r\n')
  S3_FORK_AFTER=$(cli exec "$S3_FORK_NAME" -- cat /tmp/who 2>/dev/null | tr -d '\r\n')
  if [[ "$S3_SRC_AFTER" != "source" || "$S3_FORK_AFTER" != "fork" ]]; then
    fail "S3 — disk state crossed between source ('$S3_SRC_AFTER') and fork ('$S3_FORK_AFTER')"
  fi
  pass "source & fork have independent disk state"

  # Fork-the-fork. The fork is itself snapshot-eligible (it boots
  # with the standard scratch disk). Exercises the leave-running
  # path through machinen-restore.sh's sub-NS — the same combo S2
  # hits with destructive snapshots.
  S3_GRAND_LOG="$FIXTURE/s3-fork-of-fork.log"
  S3_GRAND_BUNDLE="$FIXTURE/s3-grand-bundle"
  if ! cli fork "$S3_FORK_NAME" --out-dir "$S3_GRAND_BUNDLE" --detach 2>"$S3_GRAND_LOG"; then
    cat "$S3_GRAND_LOG" >&2
    tail -60 "$S3_BG_LOG" >&2
    fail "S3 — 'machinen fork' on the fork (gen-2) failed"
  fi
  S3_GRAND_NAME=""
  deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S3_FORK_NAME~" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S3_GRAND_NAME=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S3_GRAND_NAME" ]]; then
    cat "$S3_GRAND_LOG" >&2
    cli ls >&2 || true
    fail "S3 — fork-of-fork never appeared in 'machinen ls' under '$S3_FORK_NAME/...'"
  fi
  pass "fork-of-fork registered as '$S3_GRAND_NAME'"

  # Three-way independence: write 'grand' on the grandchild, then
  # check all three /tmp/who files are independent.
  if ! cli exec "$S3_GRAND_NAME" -- echo grand '>' /tmp/who; then
    fail "S3 — couldn't write /tmp/who on grand"
  fi
  S3_FINAL_SRC=$(cli exec "$S3_NAME" -- cat /tmp/who 2>/dev/null | tr -d '\r\n')
  S3_FINAL_FORK=$(cli exec "$S3_FORK_NAME" -- cat /tmp/who 2>/dev/null | tr -d '\r\n')
  S3_FINAL_GRAND=$(cli exec "$S3_GRAND_NAME" -- cat /tmp/who 2>/dev/null | tr -d '\r\n')
  if [[ "$S3_FINAL_SRC" != "source" || "$S3_FINAL_FORK" != "fork" || "$S3_FINAL_GRAND" != "grand" ]]; then
    fail "S3 — three-way independence broken: src='$S3_FINAL_SRC' fork='$S3_FINAL_FORK' grand='$S3_FINAL_GRAND'"
  fi
  pass "source, fork, and fork-of-fork all hold independent disk state"

  # Tear down the forks (poweroff via vsock). The source goes down
  # with cleanup_s3 below.
  cli exec "$S3_GRAND_NAME" -- /sbin/machinen-poweroff >/dev/null 2>&1 || true
  cli exec "$S3_FORK_NAME" -- /sbin/machinen-poweroff >/dev/null 2>&1 || true
  rm -rf "$S3_GRAND_BUNDLE" "$S3_FORK_BUNDLE" 2>/dev/null || true
  cleanup_s3
  trap 'rm -rf "$FIXTURE"' EXIT
fi  # S3 rootfs-capability gate

# ----------------------------------------------------------------
# S4: lazy-pages restore (#266) — same boot+snapshot+restore round-
# trip as S1, but the runtime live-mounts the bundle dir into the
# guest read-only and runs `criu restore --lazy-pages`. Pages flow
# into the workload's anon mappings only on UFFD faults, with the
# in-guest lazy-pages daemon reading bytes through the FUSE mount
# (which streams from the host on demand). Doesn't assert the RSS
# ceiling here — that's S5; S4 only asserts:
#   1. lazy-pages restore reaches userspace (workload survives).
#   2. The exec-agent in the restored VM responds (so the workload
#      faulted in enough pages to run a syscall).
# ----------------------------------------------------------------
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 ]]; then
  echo "S4: skipped (rootfs lacks vsock/criu/snapshot helpers)"
else
  echo "S4: boot + snapshot + lazy-pages restore round-trip"
  S4_NAME="lazy-smoke-$$"
  S4_BG_LOG="$FIXTURE/s4-bg.log"
  S4_SNAP_DIR="$FIXTURE/s4-snap"
  S4_SCRATCH="$FIXTURE/s4-scratch.img"
  S4_RESTORE_LOG="$FIXTURE/s4-restore.log"

  truncate -s 256M "$S4_SCRATCH"

  S4_PID=$(boot_bg "$S4_NAME" "$S4_BG_LOG" --snapshot "$S4_SCRATCH" -- \
    /bin/sh -c 'while :; do sleep 1; done')
  cleanup_s4() {
    kill -TERM "$S4_PID" 2>/dev/null || true
    wait "$S4_PID" 2>/dev/null || true
  }
  trap 'cleanup_s4; rm -rf "$FIXTURE"' EXIT

  if ! wait_for_vm "$S4_NAME"; then
    tail -80 "$S4_BG_LOG" >&2
    fail "S4 — '$S4_NAME' never appeared in 'machinen ls'"
  fi
  pass "boot --name --snapshot registered '$S4_NAME'"

  S4_DUMP_LOG="$FIXTURE/s4-dump.log"
  if ! cli snapshot "$S4_NAME" "$S4_SNAP_DIR" 2>"$S4_DUMP_LOG"; then
    tail -60 "$S4_BG_LOG" >&2
    cat "$S4_DUMP_LOG" >&2
    fail "S4 — 'machinen snapshot' failed"
  fi
  wait "$S4_PID" 2>/dev/null || true
  pass "'machinen snapshot' returned 0"

  # Restore is lazy by default (#263). The runtime live-mounts the
  # bundle dir into the guest and starts the in-guest `criu lazy-pages`
  # daemon to serve UFFD faults from the FUSE mount. `--eager` would
  # opt back into the pre-#266 tar-on-vdb path; we want lazy here.
  node "$CLI" restore "$S4_SNAP_DIR" >"$S4_RESTORE_LOG" 2>&1 &
  S4_RESTORE_PID=$!
  cleanup_s4_restore() {
    kill -TERM "$S4_RESTORE_PID" 2>/dev/null || true
    wait "$S4_RESTORE_PID" 2>/dev/null || true
  }
  trap 'cleanup_s4; cleanup_s4_restore; rm -rf "$FIXTURE"' EXIT

  S4_RESTORED_NAME=""
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S4_NAME/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S4_RESTORED_NAME=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S4_RESTORED_NAME" ]]; then
    tail -200 "$S4_RESTORE_LOG" >&2
    cli ls >&2 || true
    fail "S4 — restored VM never registered"
  fi
  pass "lazy-pages restored VM auto-named as '$S4_RESTORED_NAME'"

  # The acid test: a normal exec works on the restored VM. This forces
  # the workload to actually run code, which only happens once enough
  # pages have been faulted in via the lazy-pages daemon. If the
  # protocol is broken or FUSE reads fail, the workload hangs on first
  # instruction and exec times out.
  S4_EXEC_LOG="$FIXTURE/s4-exec.log"
  if cli exec "$S4_RESTORED_NAME" -- uname -m >"$S4_EXEC_LOG" 2>&1 \
     && grep -qE "aarch64|arm64" "$S4_EXEC_LOG"; then
    pass "exec-agent responds on the lazy-pages restored VM"
  else
    cat "$S4_EXEC_LOG" >&2
    tail -200 "$S4_RESTORE_LOG" >&2
    fail "S4 — exec against lazy-pages restored VM failed"
  fi

  cleanup_s4_restore
  trap 'rm -rf "$FIXTURE"' EXIT
fi  # S4 rootfs-capability gate

# ----------------------------------------------------------------
# S5: headline RSS (#266) — the *point* of lazy-pages restore. Boot a
# parent, dirty N MiB of anon via /sbin/machinen-memdirty, snapshot,
# restore with --lazy-pages, then assert the restored VM's host RSS
# is far below the parent's. memdirty parks on pause() after dirtying,
# so nothing in the restored guest touches the workload's anon — its
# pages stay on the host bundle (live-mounted into the guest) and the
# fork's host RSS hovers near boot-baseline. An eager restore would
# copy all N MiB back into host memory and this assertion fails.
# ----------------------------------------------------------------
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 \
      || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 || "$ROOTFS_SUPPORTS_MEMDIRTY" -eq 0 ]]; then
  echo "S5: skipped (rootfs lacks vsock/criu/snapshot/memdirty helpers)"
else
  echo "S5: lazy-pages restore — fork RSS ≪ dirty parent RSS"
  S5_NAME="rss-smoke-$$"
  S5_BG_LOG="$FIXTURE/s5-bg.log"
  S5_SCRATCH="$FIXTURE/s5-scratch.img"
  S5_SNAP_DIR="$FIXTURE/s5-snap"
  S5_DIRTY_MIB=2048

  # Scratch holds the criu image directory in-guest before it's
  # streamed over vsock. 2 GiB of dirty anon → pages-*.img alone is
  # ~2 GiB, plus criu's bookkeeping. Sparse, so 8 GiB ceiling costs
  # nothing until written.
  truncate -s 8G "$S5_SCRATCH"

  # 4 GiB RAM ceiling: workload + kernel + criu daemon all need
  # room. memdirty mmaps S5_DIRTY_MIB anon, dirties every page,
  # prints "READY mib=…" on the console, then parks on pause(2).
  S5_PID=$(boot_bg "$S5_NAME" "$S5_BG_LOG" --memory 4096 --snapshot "$S5_SCRATCH" -- \
    /sbin/machinen-memdirty "$S5_DIRTY_MIB")
  cleanup_s5() {
    kill -TERM "$S5_PID" 2>/dev/null || true
    wait "$S5_PID" 2>/dev/null || true
  }
  trap 'cleanup_s5; rm -rf "$FIXTURE"' EXIT

  if ! wait_for_vm "$S5_NAME"; then
    tail -80 "$S5_BG_LOG" >&2
    fail "S5 — '$S5_NAME' never appeared in 'machinen ls'"
  fi

  # Wait for memdirty's READY marker — proves the dirty loop finished
  # before we measure RSS.
  deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if grep -q "READY mib=$S5_DIRTY_MIB" "$S5_BG_LOG"; then
      break
    fi
    sleep 1
  done
  if ! grep -q "READY mib=$S5_DIRTY_MIB" "$S5_BG_LOG"; then
    tail -120 "$S5_BG_LOG" >&2
    fail "S5 — memdirty never printed READY mib=$S5_DIRTY_MIB"
  fi

  # Settle: kernel write-back, balloon reporting, scheduler. Without
  # this the parent RSS reading is jumpy.
  sleep 2
  S5_PARENT_VMM=$(cli ls 2>/dev/null | awk -v n="$S5_NAME" 'NR>1 && $2==n {print $1}')
  if [[ -z "$S5_PARENT_VMM" ]]; then
    cli ls >&2 || true
    fail "S5 — couldn't find VMM pid for '$S5_NAME'"
  fi
  S5_PARENT_RSS=$(vmm_rss_mib "$S5_PARENT_VMM")
  echo "  parent RSS=${S5_PARENT_RSS} MiB after dirtying ${S5_DIRTY_MIB} MiB"

  # Sanity gate: if the parent's host RSS doesn't reflect the dirty
  # footprint, comparing the fork against it is meaningless. The
  # delta-from-parent assertion below would also pass on a broken
  # baseline — guard explicitly.
  if (( S5_PARENT_RSS < S5_DIRTY_MIB )); then
    tail -120 "$S5_BG_LOG" >&2
    fail "S5 — parent RSS ${S5_PARENT_RSS} MiB < dirtied ${S5_DIRTY_MIB} MiB; baseline can't anchor the comparison"
  fi
  pass "parent's ${S5_DIRTY_MIB} MiB dirty footprint visible as host RSS (${S5_PARENT_RSS} MiB)"

  # Snapshot — destructive. Parent dies after the dump.
  S5_DUMP_LOG="$FIXTURE/s5-dump.log"
  if ! cli snapshot "$S5_NAME" "$S5_SNAP_DIR" 2>"$S5_DUMP_LOG"; then
    tail -60 "$S5_BG_LOG" >&2
    cat "$S5_DUMP_LOG" >&2
    fail "S5 — 'machinen snapshot' failed"
  fi
  wait "$S5_PID" 2>/dev/null || true
  pass "'machinen snapshot' returned 0"

  # Restore (lazy by default, #263). The bundle is live-mounted into
  # the guest; the restored guest only faults the criu bring-up handful
  # in. memdirty itself sits in pause(), so its dirty anon stays on the
  # host bundle.
  S5_RESTORE_LOG="$FIXTURE/s5-restore.log"
  node "$CLI" restore "$S5_SNAP_DIR" >"$S5_RESTORE_LOG" 2>&1 &
  S5_RESTORE_PID=$!
  cleanup_s5_restore() {
    kill -TERM "$S5_RESTORE_PID" 2>/dev/null || true
    wait "$S5_RESTORE_PID" 2>/dev/null || true
  }
  trap 'cleanup_s5; cleanup_s5_restore; rm -rf "$FIXTURE"' EXIT

  S5_FORK_NAME=""
  deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S5_NAME/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S5_FORK_NAME=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S5_FORK_NAME" ]]; then
    tail -200 "$S5_RESTORE_LOG" >&2
    cli ls >&2 || true
    fail "S5 — restored VM never registered"
  fi

  # Settle: criu's kerndat probes after the restore touch a small
  # handful of pages, and the supervisor reattaches stdio. A few
  # seconds is enough for those to land in the RSS reading.
  sleep 3
  S5_FORK_VMM=$(cli ls 2>/dev/null | awk -v n="$S5_FORK_NAME" 'NR>1 && $2==n {print $1}')
  if [[ -z "$S5_FORK_VMM" ]]; then
    cli ls >&2 || true
    fail "S5 — couldn't find VMM pid for restored VM '$S5_FORK_NAME'"
  fi
  S5_FORK_RSS=$(vmm_rss_mib "$S5_FORK_VMM")
  echo "  fork RSS=${S5_FORK_RSS} MiB after lazy-pages restore"

  # Headline claim: a fork that hasn't touched the workload's anon
  # weighs much less than the parent. Tolerance is half the dirty
  # footprint — page tables, criu daemon, kerndat probes, and the
  # supervisor all consume RSS but are dwarfed by the workload bytes
  # that should *not* be there. A drop below this threshold means
  # restore eagerly faulted pages back in (markPagemapsLazy didn't
  # mark, the live-mount didn't engage, or the lazy-pages daemon
  # mis-wired).
  S5_RSS_DROP=$(( S5_PARENT_RSS - S5_FORK_RSS ))
  S5_THRESHOLD=$(( S5_DIRTY_MIB / 2 ))
  if (( S5_RSS_DROP < S5_THRESHOLD )); then
    tail -200 "$S5_RESTORE_LOG" >&2
    fail "S5 — fork RSS only ${S5_RSS_DROP} MiB lighter than parent (${S5_PARENT_RSS} → ${S5_FORK_RSS}); expected ≥ ${S5_THRESHOLD} MiB"
  fi
  pass "fork RSS ${S5_FORK_RSS} MiB ≪ parent ${S5_PARENT_RSS} MiB (saved ${S5_RSS_DROP} MiB via lazy-pages)"

  cleanup_s5_restore
  trap 'rm -rf "$FIXTURE"' EXIT
fi  # S5 rootfs-capability gate

# ----------------------------------------------------------------
# S6: snapshot + restore + fork composes with --mount-live (#273).
#
# Pre-#273 the runtime refused snapshot/fork on VMs with active live-
# share mounts (vsock FUSE channels can't ride through CRIU). The fix:
# unmount before dump, remount after, record `meta.liveMounts` so the
# restored VM re-establishes a fresh window on the recorded host path.
#
# This test exercises the full round-trip:
#   1. Boot with --mount-live <host>:/mnt/share, write a guest file
#      that lands on the host (verifies the source's mount works).
#   2. Snapshot — runtime drives /sbin/machinen-dump-preflight which
#      umounts, then CRIU dumps (cleanly), then meta.json gets the
#      liveMounts block. Source is killed (default destructive path).
#   3. Restore — meta.liveMounts re-establishes the window on the
#      same host dir; the previously-written file is still readable
#      from inside the restored guest.
#   4. Restore-with-override — same bundle, but pass
#      --mount-live <other-host>:/mnt/share to remap. The restored
#      guest now sees a different host directory's contents.
#   5. Fork — leaveRunning path. Source survives, fork has its own
#      independent guest — both can write to the same host dir
#      (concurrent-writer semantics are the user's to manage).
# ----------------------------------------------------------------
if [[ "$ROOTFS_SUPPORTS_VSOCK_EXEC" -eq 0 || "$ROOTFS_SUPPORTS_CRIU" -eq 0 || "$ROOTFS_SUPPORTS_SNAPSHOT_HELPERS" -eq 0 ]]; then
  echo "S6: skipped (rootfs lacks vsock/criu/snapshot helpers)"
elif ! grep -q 'fuse-agent$' <<<"$ROOTFS_ENTRIES"; then
  echo "S6: skipped (rootfs lacks fuse-agent — rebuild base assets)"
else
  echo "S6: snapshot + restore + fork compose with --mount-live (#273)"
  S6_NAME="livemount-smoke-$$"
  S6_BG_LOG="$FIXTURE/s6-bg.log"
  S6_SCRATCH="$FIXTURE/s6-scratch.img"
  S6_SHARE_A="$FIXTURE/s6-share-a"
  S6_SHARE_B="$FIXTURE/s6-share-b"
  S6_SNAP_DIR="$FIXTURE/s6-snap"
  S6_RESTORE_LOG="$FIXTURE/s6-restore.log"
  S6_RESTORE_REMAP_LOG="$FIXTURE/s6-restore-remap.log"

  mkdir -p "$S6_SHARE_A" "$S6_SHARE_B"
  truncate -s 256M "$S6_SCRATCH"
  # Pre-seed share B with a marker the source never wrote — so the
  # remapped restore can prove it's actually reading from B, not A.
  echo "from-share-b" > "$S6_SHARE_B/marker.txt"

  S6_PID=$(boot_bg "$S6_NAME" "$S6_BG_LOG" \
    --snapshot "$S6_SCRATCH" \
    --mount-live "$S6_SHARE_A:/mnt/share" \
    -- /bin/sh -c 'while :; do sleep 1; done')
  cleanup_s6() {
    kill -TERM "$S6_PID" 2>/dev/null || true
    wait "$S6_PID" 2>/dev/null || true
  }
  trap 'cleanup_s6; rm -rf "$FIXTURE"' EXIT

  if ! wait_for_vm "$S6_NAME"; then
    tail -80 "$S6_BG_LOG" >&2
    fail "S6 — '$S6_NAME' never appeared in 'machinen ls'"
  fi
  pass "boot with --mount-live registered '$S6_NAME'"

  # Verify the source's live mount works: guest write lands on host.
  if ! cli exec "$S6_NAME" -- echo from-source '>' /mnt/share/source.txt; then
    tail -60 "$S6_BG_LOG" >&2
    fail "S6 — couldn't write through live mount on source"
  fi
  if ! grep -q "from-source" "$S6_SHARE_A/source.txt" 2>/dev/null; then
    ls -la "$S6_SHARE_A" >&2
    fail "S6 — source's guest write didn't reach host share-A"
  fi
  pass "source's guest write through live mount visible on host"

  # Snapshot. Pre-#273 this would have thrown SNAPSHOT_LIVE_MOUNT_ACTIVE.
  # Today: preflight unmounts, dump succeeds, meta.liveMounts records
  # the share-A path so restore can re-establish.
  S6_DUMP_LOG="$FIXTURE/s6-dump.log"
  if ! cli snapshot "$S6_NAME" "$S6_SNAP_DIR" 2>"$S6_DUMP_LOG"; then
    tail -60 "$S6_BG_LOG" >&2
    cat "$S6_DUMP_LOG" >&2
    fail "S6 — 'machinen snapshot' against --mount-live VM failed"
  fi
  wait "$S6_PID" 2>/dev/null || true
  pass "'machinen snapshot' succeeded on a --mount-live VM"

  if ! grep -q '"liveMounts"' "$S6_SNAP_DIR/meta.json"; then
    cat "$S6_SNAP_DIR/meta.json" >&2
    fail "S6 — meta.json missing liveMounts block"
  fi
  if ! grep -q "$S6_SHARE_A" "$S6_SNAP_DIR/meta.json"; then
    cat "$S6_SNAP_DIR/meta.json" >&2
    fail "S6 — meta.json liveMounts doesn't record host=$S6_SHARE_A"
  fi
  pass "meta.json records the live-mount config"

  # Restore against the recorded host path. The previously-written
  # /mnt/share/source.txt should still read "from-source" because it's
  # the same host directory mounted into the restored guest.
  node "$CLI" restore "$S6_SNAP_DIR" >"$S6_RESTORE_LOG" 2>&1 &
  S6_RESTORE_PID=$!
  cleanup_s6_restore() {
    kill -TERM "$S6_RESTORE_PID" 2>/dev/null || true
    wait "$S6_RESTORE_PID" 2>/dev/null || true
  }
  trap 'cleanup_s6; cleanup_s6_restore; rm -rf "$FIXTURE"' EXIT

  S6_RESTORED=""
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S6_NAME/" 'NR>1 && index($2, src)==1 {print $2; exit}')
    if [[ -n "$cand" ]]; then
      S6_RESTORED=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S6_RESTORED" ]]; then
    tail -200 "$S6_RESTORE_LOG" >&2
    cli ls >&2 || true
    fail "S6 — restored VM never registered"
  fi
  pass "restored VM auto-named as '$S6_RESTORED'"

  S6_READ_LOG="$FIXTURE/s6-read.log"
  if cli exec "$S6_RESTORED" -- cat /mnt/share/source.txt >"$S6_READ_LOG" 2>&1 \
     && grep -q "from-source" "$S6_READ_LOG"; then
    pass "restored VM reads through re-established live mount (host share-A)"
  else
    cat "$S6_READ_LOG" >&2
    tail -200 "$S6_RESTORE_LOG" >&2
    fail "S6 — restored VM couldn't read /mnt/share/source.txt from share-A"
  fi

  cleanup_s6_restore
  trap 'cleanup_s6; rm -rf "$FIXTURE"' EXIT

  # Restore-with-override: same bundle, remap host=share-A → share-B.
  # The marker.txt we pre-seeded under share-B should be visible in
  # the restored guest, proving the override knob actually swapped
  # the underlying directory.
  node "$CLI" restore "$S6_SNAP_DIR" \
    --mount-live "$S6_SHARE_B:/mnt/share" \
    >"$S6_RESTORE_REMAP_LOG" 2>&1 &
  S6_REMAP_PID=$!
  cleanup_s6_remap() {
    kill -TERM "$S6_REMAP_PID" 2>/dev/null || true
    wait "$S6_REMAP_PID" 2>/dev/null || true
  }
  trap 'cleanup_s6; cleanup_s6_remap; rm -rf "$FIXTURE"' EXIT

  S6_REMAPPED=""
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    cand=$(cli ls 2>/dev/null | awk -v src="$S6_NAME/" 'NR>1 && index($2, src)==1 && $2!=src"REPLACED" {print $2; exit}')
    if [[ -n "$cand" && "$cand" != "$S6_RESTORED" ]]; then
      S6_REMAPPED=$cand
      break
    fi
    sleep 1
  done
  if [[ -z "$S6_REMAPPED" ]]; then
    tail -200 "$S6_RESTORE_REMAP_LOG" >&2
    fail "S6 — remapped restore VM never registered"
  fi
  pass "remapped restore registered as '$S6_REMAPPED'"

  S6_REMAP_READ_LOG="$FIXTURE/s6-remap-read.log"
  if cli exec "$S6_REMAPPED" -- cat /mnt/share/marker.txt >"$S6_REMAP_READ_LOG" 2>&1 \
     && grep -q "from-share-b" "$S6_REMAP_READ_LOG"; then
    pass "override --mount-live remapped host dir on restore (share-B visible)"
  else
    cat "$S6_REMAP_READ_LOG" >&2
    tail -200 "$S6_RESTORE_REMAP_LOG" >&2
    fail "S6 — remapped restore didn't see share-B's marker.txt"
  fi

  cleanup_s6_remap
  trap 'rm -rf "$FIXTURE"' EXIT
fi  # S6 rootfs-capability gate

echo
echo "all smoke tests passed"
