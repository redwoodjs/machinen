#!/usr/bin/env bash
# Build the host-side machinen-runtime-helper helper and stage it next to the
# other native host tools. The TypeScript runtime resolves this binary
# from @machinen/native-<arch>-<os> and uses it for Zig-owned helper
# operations such as mountdisk tree-manifest hashing.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PKG="$ROOT/packages/runtime/native"
OS=$(uname -s)
ARCH=$(uname -m)
case "$OS:$ARCH" in
  Darwin:arm64) PKG_ARCH="arm64"; PKG_OS="darwin" ;;
  Linux:aarch64|Linux:arm64) PKG_ARCH="arm64"; PKG_OS="linux" ;;
  Linux:x86_64|Linux:amd64) PKG_ARCH="x64"; PKG_OS="linux" ;;
  *)
    echo "unsupported host for runtime helper staging: $OS/$ARCH" >&2
    exit 1
    ;;
esac

DEST_DIR="$ROOT/packages/native-${PKG_ARCH}-${PKG_OS}/vmm/bin"
DEST="$DEST_DIR/machinen-runtime-helper"

echo "==> building machinen-runtime-helper (zig ReleaseSafe)"
( cd "$PKG" && zig build -Doptimize=ReleaseSafe )

echo "==> staging into $DEST"
mkdir -p "$DEST_DIR"
cp "$PKG/zig-out/bin/machinen-runtime-helper" "$DEST"

if [[ "$OS" == "Darwin" ]]; then
  # machinen-runtime-helper does not need entitlements, but clearing provenance
  # keeps the staged host tool consistent with the VMM staging flow.
  xattr -c "$DEST" || true
fi

echo "==> Done."
