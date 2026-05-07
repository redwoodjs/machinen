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
#   scripts/check-asset-freshness.sh           # exit 1 if stale
#   scripts/check-asset-freshness.sh --quiet   # suppress the ok line
#
# Sourceable: when sourced (`source check-asset-freshness.sh`) the
# helper functions are exposed but `main` is not run. Used by
# build-base-assets.sh to write the sidecars without re-implementing
# the file list.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
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
    "${ASSETS}/machinen-restore.sh" \
    "${ASSETS}/machinen-supervisor.sh" \
    "${ASSETS}/memdirty.zig" \
    "${ASSETS}/net-bench-probe.zig" \
    "${ASSETS}/no-iou.zig" \
    "${ASSETS}/poweroff.zig" \
    "${ASSETS}/winsize-agent.zig" \
    "${SCRIPTS}/build-base-assets.sh"
}

# Files whose contents are baked into Image-arm64. The kernel itself
# comes from upstream kernel.org pinned by version inside
# build-kernel-arm64.sh — that single script captures version pin,
# CONFIG_ overrides, and patch list, so it's the only input we track.
# virt.dts contributes to virt-arm64.dtb (compiled alongside the
# kernel) so it's listed here too.
kernel_input_files() {
  printf '%s\n' \
    "${ASSETS}/virt.dts" \
    "${SCRIPTS}/build-kernel-arm64.sh"
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

# Compare a sidecar against a freshly-computed input hash. The third
# argument is the function that lists the inputs (rootfs_input_files
# or kernel_input_files).
verify_sidecar() {
  local label="$1"
  local sidecar="$2"
  local inputs_fn="$3"
  if [[ ! -f "$sidecar" ]]; then
    echo "asset-freshness: ${label}: sidecar ${sidecar##*/} missing" >&2
    echo "  this release-assets/ was built before the freshness checker landed" >&2
    echo "  rebuild to populate the sidecar: bash scripts/build-base-assets.sh" >&2
    return 2
  fi
  local expected actual
  expected=$(cat "$sidecar")
  actual=$("$inputs_fn" | compute_sha)
  if [[ "$expected" != "$actual" ]]; then
    echo "asset-freshness: ${label}: STALE — inputs have changed since the binary was built" >&2
    echo "  expected (from sidecar): $expected" >&2
    echo "  actual   (from sources): $actual" >&2
    echo "  fix: bash scripts/build-base-assets.sh" >&2
    return 1
  fi
  return 0
}

main() {
  local quiet=false
  if [[ "${1:-}" == "--quiet" ]]; then
    quiet=true
  fi

  # Treat "no release-assets at all" as a soft skip — the smoke-tests
  # entry point handles building from scratch, and this checker is
  # about catching drift, not about gating the first build.
  if [[ ! -d "$OUT" ]]; then
    if ! $quiet; then
      echo "asset-freshness: ${OUT##*/} not present, skipping check"
    fi
    return 0
  fi

  local rootfs_rc=0 kernel_rc=0
  verify_sidecar "rootfs" "${OUT}/rootfs-debian-arm64.tar.gz.inputs-sha256" rootfs_input_files \
    || rootfs_rc=$?
  verify_sidecar "kernel" "${OUT}/Image-arm64.inputs-sha256" kernel_input_files \
    || kernel_rc=$?

  # Stale (rc=1) is a hard failure. Missing sidecar (rc=2) is soft —
  # warn but pass, so older checkouts can still run smoke-tests.
  if (( rootfs_rc == 1 )) || (( kernel_rc == 1 )); then
    return 1
  fi
  if ! $quiet; then
    echo "asset-freshness: ok"
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
