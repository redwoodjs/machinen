#!/usr/bin/env bash
# Verify each @machinen/vmm-arm64-* package would publish a usable tarball.
#
# What this catches (issue #309):
#   1. Host binaries (bin/machinen-vm, bin/gvproxy) lacking the +x bit in
#      the tarball — pnpm pack normalizes file modes to 0644 unless the
#      file is declared in the `bin` field of package.json. Without +x,
#      `boot()` exits at gvproxy spawn (code=127).
#   2. Guest binaries (guest/{init,fuse-agent,exec-agent}) missing from
#      the tarball — `boot()` throws MKINITRAMFS_INIT_MISSING.
#
# Runs `pnpm pack` against each vmm package (dry-run is not enough — we
# need the actual tarball to inspect modes), then greps `tar -tvf`
# output for the expected entries. Exits nonzero on any miss.
#
# Designed for CI (release.yml runs this before `changeset publish`).
# Safe to run locally after `scripts/build-base-assets.sh` has populated
# packages/vmm-arm64-*/bin/ + guest/.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failed=0

# Files we expect, and the mode they must have in the tarball.
#   bin/* — host binaries, must be executable (0755).
#   guest/* — guest ELFs, read as data by the runtime; mode doesn't
#             matter to functionality, but we still assert presence so
#             a missing file fails the release fast.
expected_executable=(
  "package/bin/machinen-vm"
  "package/bin/gvproxy"
)
expected_present=(
  "package/guest/init"
  "package/guest/fuse-agent"
  "package/guest/exec-agent"
)

for pkg in vmm-arm64-darwin vmm-arm64-linux; do
  echo "==> Verifying @machinen/${pkg}"
  pkg_dir="${ROOT}/packages/${pkg}"
  (cd "$pkg_dir" && pnpm pack --pack-destination "$TMP" >/dev/null)
  tarball="$(ls "$TMP"/machinen-${pkg}-*.tgz | head -n1)"
  if [ -z "$tarball" ]; then
    echo "  ERROR: pnpm pack produced no tarball for $pkg"
    failed=1
    continue
  fi
  listing="$(tar -tvf "$tarball")"

  for entry in "${expected_executable[@]}"; do
    line="$(printf '%s\n' "$listing" | grep -E "[[:space:]]${entry}\$" || true)"
    if [ -z "$line" ]; then
      echo "  ERROR: $pkg tarball missing $entry"
      failed=1
      continue
    fi
    # First field of `tar -tvf` is the mode string, e.g. "-rwxr-xr-x".
    mode="$(printf '%s' "$line" | awk '{print $1}')"
    if [[ "$mode" != *x* ]]; then
      echo "  ERROR: $pkg tarball has $entry with mode '$mode' (expected user+x)"
      failed=1
    fi
  done

  for entry in "${expected_present[@]}"; do
    if ! printf '%s\n' "$listing" | grep -qE "[[:space:]]${entry}\$"; then
      echo "  ERROR: $pkg tarball missing $entry"
      failed=1
    fi
  done

  rm -f "$tarball"
done

if [ "$failed" -ne 0 ]; then
  echo "==> verify-vmm-packages: FAIL"
  exit 1
fi
echo "==> verify-vmm-packages: OK"
