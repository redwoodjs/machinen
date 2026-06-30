#!/usr/bin/env bash
# Fast dev loop: rebuild only the TS packages we iterate on
# (@machinen/runtime + @machinen/cli), make sure the VMM and
# release-assets aren't stale relative to source, then forward any
# remaining args to the locally-built CLI.
#
# Producers (called automatically when missing or stale):
#   - VMM:    bash scripts/build-vmm.sh
#   - runtime helper: bash scripts/build-runtime-helper.sh
#   - assets: bash scripts/build-base-assets.sh
#
# Usage:
#   mn-dev                                    # build + validate only
#   mn-dev boot --name foo -- /bin/sh -i      # build + validate + run CLI

set -euo pipefail

USER_CWD="$PWD"
ROOT=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)
cd "$ROOT"

step() { printf '\n==> %s\n' "$*" >&2; }

step "building @machinen/runtime + @machinen/cli"
pnpm -F @machinen/runtime -F @machinen/cli build

# A missing or unsigned VMM is a terminal state for `boot` (ENOENT or
# HV_DENIED), and rebuilding is cheap (zig incremental, ~1s warm), so
# treat both as auto-recoverable instead of aborting the dev loop.
VMM="$ROOT/packages/native-arm64-darwin/vmm/bin/machinen-vm"
if [[ ! -x "$VMM" ]] \
   || ! codesign -d --entitlements - "$VMM" 2>/dev/null \
        | grep -q "com.apple.security.hypervisor"; then
  step "VMM missing or unsigned — rebuilding"
  bash "$ROOT/scripts/build-vmm.sh"
fi

RUNTIME_HELPER="$ROOT/packages/native-arm64-darwin/vmm/bin/machinen-runtime-helper"
if [[ ! -x "$RUNTIME_HELPER" ]]; then
  step "machinen-runtime-helper missing — rebuilding"
  bash "$ROOT/scripts/build-runtime-helper.sh"
fi

# Stale-source check covers rootfs, kernel, and VMM. Dispatch on
# `--what-stale` so balloon.zig edits don't trigger the slow rootfs
# rebuild and vice versa.
stale=$(bash "$ROOT/scripts/check-asset-freshness.sh" --what-stale)
if [[ -n "$stale" ]]; then
  step "stale: $(echo "$stale" | tr '\n' ' ')— rebuilding"
  if echo "$stale" | grep -qx vmm; then
    bash "$ROOT/scripts/build-vmm.sh"
  fi
  if echo "$stale" | grep -qE '^(rootfs|kernel)$'; then
    bash "$ROOT/scripts/build-base-assets.sh"
  fi
fi

if (( $# > 0 )); then
  step "running: machinen $*"
  cd "$USER_CWD"
  exec env MACHINEN_ASSETS_DIR="$ROOT/release-assets" \
    MACHINEN_RUNTIME_HELPER="$RUNTIME_HELPER" \
    node "$ROOT/packages/cli/dist/cli.js" "$@"
fi
