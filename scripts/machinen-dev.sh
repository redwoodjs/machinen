#!/usr/bin/env bash
# Build everything from source and boot a microVM into an interactive /bin/sh.
# No caching — every step runs on every invocation, so this is a reliable
# "it works end-to-end" check. For the fast dev loop, invoke the underlying
# CLI directly against an already-built tree.
#
# Usage:
#   pnpm machinen-dev
# or:
#   bash scripts/machinen-dev.sh

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

step() { printf '\n==> %s\n' "$*" >&2; }

step "building @machinen/runtime + @machinen/cli"
pnpm -F @machinen/runtime -F @machinen/cli build

step "building Zig VMM (ReleaseSafe) + codesigning with HVF entitlement"
(
  cd packages/microvm
  zig build -Doptimize=ReleaseSafe
  codesign -s - --force --entitlements entitlements.plist zig-out/bin/microvm
)
mkdir -p packages/vmm-arm64-darwin/bin
cp packages/microvm/zig-out/bin/microvm packages/vmm-arm64-darwin/bin/microvm

step "building base assets (kernel + dtb + rootfs tarball)"
./scripts/build-base-assets.sh

step "booting (name=dev) — Ctrl-D (in shell) to exit cleanly, Ctrl-C to kill from host"
exec env MACHINEN_ASSETS_DIR="$ROOT/release-assets" \
  node "$ROOT/packages/cli/dist/cli.js" boot \
    --name dev \
    --env PATH=/usr/local/bin:/usr/bin:/bin:/sbin \
    --env HOME=/root \
    --env TERM=xterm-256color \
    --env "PS1=(microvm-dev) # " \
    -- /bin/sh -i
