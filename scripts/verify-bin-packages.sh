#!/usr/bin/env bash
# Verify each host-tool binary package would publish a usable tarball.
#
# Covers (issue #309):
#   - @machinen/native-arm64-{darwin,linux} and @machinen/native-x64-linux
#     — the consolidated host-tool packages: VMM + gvproxy + guest ELFs,
#     mke2fs, and mksquashfs, all under per-tool subdirs.
#
# What this catches:
#   1. Host-side binaries (the things node spawns: machinen-vm,
#      machinen-runtime-helper, gvproxy, mke2fs, mksquashfs) lacking the +x bit
#      in the tarball — pnpm pack normalizes file modes to 0644 unless
#      the file is declared in the
#      `bin` field of package.json. Without +x the runtime exits at
#      spawn (code=127).
#   2. Files we expect to ship missing entirely — e.g. the vmm packages'
#      guest/{init,exec-agent} ELFs.
#
# Runs `pnpm pack` against each package (dry-run is not enough — we
# need the actual tarball to inspect modes), then greps `tar -tvf`
# output. Exits nonzero on any miss.
#
# Designed for CI (release.yml runs this before `changeset publish`).
# Safe to run locally after the staging steps have populated each
# package's bin/, guest/, and lib/ dirs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failed=0

# Per-package expectations. Two lists per package:
#   exec  — must be in the tarball AND have the user-executable bit.
#           These are the binaries node spawns directly.
#   plain — must be in the tarball; mode doesn't matter (data files or
#           dylibs loaded by dlopen, where 0644 is fine).
#
# Adding a new bundled-binary package? Append a stanza below.
check_pkg() {
  local pkg="$1"
  shift
  local exec_entries=()
  local plain_entries=()
  local mode="exec"
  for arg in "$@"; do
    case "$arg" in
      --plain) mode="plain" ;;
      *)
        if [[ "$mode" == "exec" ]]; then
          exec_entries+=("$arg")
        else
          plain_entries+=("$arg")
        fi
        ;;
    esac
  done

  echo "==> Verifying @machinen/${pkg}"
  local pkg_dir="${ROOT}/packages/${pkg}"
  (cd "$pkg_dir" && pnpm pack --pack-destination "$TMP" >/dev/null)
  local tarball
  tarball="$(ls "$TMP"/machinen-${pkg}-*.tgz 2>/dev/null | head -n1)"
  if [ -z "$tarball" ]; then
    echo "  ERROR: pnpm pack produced no tarball for $pkg"
    failed=1
    return
  fi
  local listing
  listing="$(tar -tvf "$tarball")"

  for entry in ${exec_entries[@]+"${exec_entries[@]}"}; do
    local line
    line="$(printf '%s\n' "$listing" | grep -E "[[:space:]]package/${entry}\$" || true)"
    if [ -z "$line" ]; then
      echo "  ERROR: $pkg tarball missing package/$entry"
      failed=1
      continue
    fi
    # First field of `tar -tvf` is the mode string, e.g. "-rwxr-xr-x".
    local m
    m="$(printf '%s' "$line" | awk '{print $1}')"
    if [[ "$m" != *x* ]]; then
      echo "  ERROR: $pkg tarball has package/$entry with mode '$m' (expected user+x)"
      failed=1
    fi
  done

  for entry in ${plain_entries[@]+"${plain_entries[@]}"}; do
    if ! printf '%s\n' "$listing" | grep -qE "[[:space:]]package/${entry}\$"; then
      echo "  ERROR: $pkg tarball missing package/$entry"
      failed=1
    fi
  done

  rm -f "$tarball"
}

# --- native-* ------------------------------------------------------------
# One consolidated package per host arch. Per-tool subdirs:
#   vmm/bin/{machinen-vm,machinen-runtime-helper,machinen-pdeathsig,machinen-pty,gvproxy}   host binaries node spawns.
#   vmm/guest/{init,exec-agent}  guest-arch Linux ELFs the runtime
#       reads as data to pack into the initramfs cpio (mode irrelevant).
#   e2fsprogs/bin/mke2fs, squashfs/bin/mksquashfs  host binaries node spawns.
for pkg in native-arm64-darwin native-arm64-linux native-x64-linux; do
  check_pkg "$pkg" \
    vmm/bin/machinen-vm \
    vmm/bin/machinen-runtime-helper \
    vmm/bin/machinen-pdeathsig \
    vmm/bin/machinen-pty \
    vmm/bin/gvproxy \
    e2fsprogs/bin/mke2fs \
    squashfs/bin/mksquashfs \
    --plain \
    vmm/guest/init \
    vmm/guest/exec-agent
done

if [ "$failed" -ne 0 ]; then
  echo "==> verify-bin-packages: FAIL"
  exit 1
fi
echo "==> verify-bin-packages: OK"
