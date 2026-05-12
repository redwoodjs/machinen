#!/usr/bin/env bash
# Detect when release-assets/ is stale relative to the source files
# that produced it. Without this, an out-of-date rootfs.tar.gz looks
# like a runtime bug at snapshot time (S1 hangs 10s in trying to talk
# to a /sbin/machinen-dump that doesn't match the host's expectations)
# rather than the asset-mismatch it actually is.
#
# How it works:
#   - At build time, scripts/build-base-assets.sh hashes the input
#     files and writes the digest to a sidecar:
#       release-assets/rootfs-debian-arm64.tar.gz.inputs-sha256
#       release-assets/Image-arm64.inputs-sha256
#   - At check time (this script), the same input files are hashed
#     and compared against the sidecar. A mismatch means the source
#     has moved on since the binary was built.
#
# Sidecar absent = release-assets/ predates this checker. Treated as
# a soft failure: warn, but don't block, so a checkout from before
# the checker landed still smokes.
#
# Usage:
#   scripts/check-asset-freshness.sh              # exit 1 if stale
#   scripts/check-asset-freshness.sh --quiet      # suppress the ok line
#   scripts/check-asset-freshness.sh --what-stale # print stale artifact
#                                                 #   names (rootfs|kernel|
#                                                 #   vmm), one per line,
#                                                 #   to stdout — exits 0
#                                                 #   regardless. Used by
#                                                 #   mn-dev to dispatch
#                                                 #   only the rebuilds
#                                                 #   needed.
#
# Sourceable: when sourced (`source check-asset-freshness.sh`) the
# helper functions are exposed but `main` is not run. Used by
# build-base-assets.sh and build-vmm.sh to write the sidecars without
# re-implementing the file list.

set -eu

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ASSETS="${ROOT}/packages/microvm/assets"
SCRIPTS="${ROOT}/scripts"
OUT="${ROOT}/release-assets"

# Files whose contents are baked into rootfs-debian-arm64.tar.gz.
# - The .zig sources are compiled to /init, /exec-agent, /sbin/...
#   inside the rootfs.
# - The .sh scripts are copied verbatim under /sbin.
# - machinen-netup.c is zig-cc'd into /sbin/machinen-netup.
# - The build script itself is included so a change to install paths
#   or Debian package pins triggers a rebuild even when no asset
#   source moved.
rootfs_input_files() {
  printf '%s\n' \
    "${ASSETS}/exec-agent.zig" \
    "${ASSETS}/fuse-agent.zig" \
    "${ASSETS}/init.zig" \
    "${ASSETS}/lo-up.zig" \
    "${ASSETS}/machinen-dump-preflight.sh" \
    "${ASSETS}/machinen-dump.sh" \
    "${ASSETS}/machinen-netup.c" \
    "${ASSETS}/machinen-remount.sh" \
    "${ASSETS}/machinen-restore.sh" \
    "${ASSETS}/machinen-supervisor.sh" \
    "${ASSETS}/memdirty.zig" \
    "${ASSETS}/net-bench-probe.zig" \
    "${ASSETS}/no-iou.zig" \
    "${ASSETS}/poweroff.zig" \
    "${ASSETS}/winsize-agent.zig" \
    "${SCRIPTS}/build-base-assets.sh"
  # CRIU patches applied during the rootfs build. Scoped to
  # patches/criu/ so kernel patches under patches/kernel/ (consumed
  # by the kernel build, see kernel_input_files) don't accidentally
  # invalidate the rootfs sidecar. Sorted for stable ordering. Guard
  # on the dir existing — under `set -eo pipefail` an unguarded find
  # on a missing dir returns 1 and tanks the whole input-hash step.
  if [ -d "${ROOT}/packages/microvm/patches/criu" ]; then
    find "${ROOT}/packages/microvm/patches/criu" -type f -name "*.patch" | LC_ALL=C sort
  fi
}

# Files whose contents are baked into Image-arm64. The kernel itself
# comes from upstream kernel.org pinned by version inside
# build-kernel-arm64.sh — that single script captures version pin and
# CONFIG_ overrides. Patches in packages/microvm/patches/kernel/ are
# applied on top by the same script, so changing or adding a patch
# must also invalidate the sidecar. virt.dts contributes to
# virt-arm64.dtb (compiled alongside the kernel) so it's listed here
# too.
kernel_input_files() {
  printf '%s\n' \
    "${ASSETS}/virt.dts" \
    "${SCRIPTS}/build-kernel-arm64.sh"
  if [ -d "${ROOT}/packages/microvm/patches/kernel" ]; then
    find "${ROOT}/packages/microvm/patches/kernel" -maxdepth 1 -type f \
      -name '*.patch' -print | sort
  fi
}

# Files whose contents are baked into
# packages/vmm-arm64-darwin/bin/machinen-vm. We `find` every .zig
# under packages/microvm/src so a newly added source file
# automatically invalidates the sidecar — listing them explicitly (as
# rootfs_input_files does for assets/) would silently miss new files
# and give us back the exact bug this checker is supposed to prevent.
# Sort for stable order across find implementations (BSD find on
# darwin doesn't sort by default).
#
# Also pulled in:
#   - build.zig + build.zig.zon: build graph + dep pins.
#   - entitlements.plist: applied via codesign on darwin and gates HVF.
#   - build-vmm.sh itself: a change to flags or staging path should
#     invalidate the sidecar even when no .zig source moved.
vmm_input_files() {
  find "${ROOT}/packages/microvm/src" -type f -name '*.zig' -print | sort
  printf '%s\n' \
    "${ROOT}/packages/microvm/build.zig" \
    "${ROOT}/packages/microvm/build.zig.zon" \
    "${ROOT}/packages/microvm/entitlements.plist" \
    "${SCRIPTS}/build-vmm.sh"
}

# Read filenames on stdin (one per line, in stable order from the
# *_input_files producers above), `cat` the bytes through a single
# sha256 stream. Concatenating the files (rather than per-file digest +
# digest-of-digests) keeps the helper trivial; the file list is fixed
# so this is reproducible across machines.
compute_sha() {
  local f
  while IFS= read -r f; do
    if [[ ! -f "$f" ]]; then
      echo "asset-freshness: input file missing: $f" >&2
      return 1
    fi
    cat "$f"
  done | shasum -a 256 | awk '{print $1}'
}

# Compare a sidecar against a freshly-computed input hash.
#
#   $1 label      — short artifact name shown in messages.
#   $2 sidecar    — path to the inputs-sha256 file written by the producer.
#   $3 inputs_fn  — function that lists the input files (rootfs_input_files,
#                   kernel_input_files, vmm_input_files).
#   $4 producer   — shell command shown to the user in the "fix:" hint.
#                   Per-artifact so the VMM and asset paths don't get
#                   crossed up.
verify_sidecar() {
  local label="$1"
  local sidecar="$2"
  local inputs_fn="$3"
  local producer="$4"
  if [[ ! -f "$sidecar" ]]; then
    echo "asset-freshness: ${label}: sidecar ${sidecar##*/} missing" >&2
    echo "  this artifact was built before the freshness checker landed" >&2
    echo "  rebuild to populate the sidecar: ${producer}" >&2
    return 2
  fi
  local expected actual
  expected=$(cat "$sidecar")
  actual=$("$inputs_fn" | compute_sha)
  if [[ "$expected" != "$actual" ]]; then
    echo "asset-freshness: ${label}: STALE — inputs have changed since the binary was built" >&2
    echo "  expected (from sidecar): $expected" >&2
    echo "  actual   (from sources): $actual" >&2
    echo "  fix: ${producer}" >&2
    return 1
  fi
  return 0
}

# Path to the staged VMM binary. The sidecar lives next to it so it
# travels with the artifact (matches the rootfs/kernel pattern under
# release-assets/).
vmm_dest_path() {
  printf '%s' "${ROOT}/packages/vmm-arm64-darwin/bin/machinen-vm"
}

main() {
  local quiet=false
  case "${1:-}" in
    --quiet) quiet=true ;;
    --what-stale) what_stale; return 0 ;;
  esac

  local rootfs_rc=0 kernel_rc=0 vmm_rc=0

  # Each artifact has its own existence guard so a missing one gives a
  # soft skip (covered elsewhere — smoke-tests.sh and mn-dev handle
  # first builds), without hiding staleness in the others.
  if [[ -d "$OUT" ]]; then
    verify_sidecar "rootfs" "${OUT}/rootfs-debian-arm64.tar.gz.inputs-sha256" \
      rootfs_input_files "bash scripts/build-base-assets.sh" \
      || rootfs_rc=$?
    verify_sidecar "kernel" "${OUT}/Image-arm64.inputs-sha256" \
      kernel_input_files "bash scripts/build-base-assets.sh" \
      || kernel_rc=$?
  elif ! $quiet; then
    echo "asset-freshness: ${OUT##*/} not present, skipping rootfs/kernel check"
  fi

  local vmm
  vmm=$(vmm_dest_path)
  if [[ -f "$vmm" ]]; then
    verify_sidecar "vmm" "${vmm}.inputs-sha256" \
      vmm_input_files "bash scripts/build-vmm.sh" \
      || vmm_rc=$?
  elif ! $quiet; then
    echo "asset-freshness: VMM not staged at ${vmm#${ROOT}/}, skipping vmm check"
  fi

  # Stale (rc=1) is a hard failure. Missing sidecar (rc=2) is soft —
  # warn but pass, so older checkouts can still run smoke-tests.
  if (( rootfs_rc == 1 )) || (( kernel_rc == 1 )) || (( vmm_rc == 1 )); then
    return 1
  fi
  if ! $quiet; then
    echo "asset-freshness: ok"
  fi
  return 0
}

# Emit one line per stale artifact (rootfs|kernel|vmm) to stdout,
# silencing verify_sidecar's human-readable explanations on stderr.
# Always returns 0 so `mn-dev` can capture the list with `$(...)` and
# dispatch the right rebuild script per artifact, instead of
# unconditionally rebuilding everything.
what_stale() {
  local rc
  if [[ -d "$OUT" ]]; then
    rc=0
    verify_sidecar "rootfs" "${OUT}/rootfs-debian-arm64.tar.gz.inputs-sha256" \
      rootfs_input_files "bash scripts/build-base-assets.sh" \
      >/dev/null 2>&1 || rc=$?
    (( rc == 1 )) && echo rootfs

    rc=0
    verify_sidecar "kernel" "${OUT}/Image-arm64.inputs-sha256" \
      kernel_input_files "bash scripts/build-base-assets.sh" \
      >/dev/null 2>&1 || rc=$?
    (( rc == 1 )) && echo kernel
  fi

  local vmm
  vmm=$(vmm_dest_path)
  if [[ -f "$vmm" ]]; then
    rc=0
    verify_sidecar "vmm" "${vmm}.inputs-sha256" \
      vmm_input_files "bash scripts/build-vmm.sh" \
      >/dev/null 2>&1 || rc=$?
    (( rc == 1 )) && echo vmm
  fi
  return 0
}

# When run directly, dispatch to main. When sourced (BASH_SOURCE !=
# $0, which happens under `source path/to/this`), only the helpers
# get exposed. The `:-` defaults guard against `set -u` blowing up
# in callers that source us before BASH_SOURCE has been populated
# (e.g. zsh, where the array doesn't exist at all).
if [[ "${BASH_SOURCE[0]:-}" == "${0:-}" ]]; then
  main "$@"
fi
