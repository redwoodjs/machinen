#!/usr/bin/env bash
# Build a relocatable mke2fs bundle for arm64 darwin and drop it at
# bin/mke2fs (+ lib/*.dylib).
#
# macOS has no static libc, so "ship a self-contained mke2fs" means
# copying the brew dylibs alongside the binary and rewriting the
# install-name references to use @loader_path. Then re-sign because
# install_name_tool invalidates the ad-hoc signature.
#
# Prereq: `brew install e2fsprogs gettext` on the build host.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$PKG_DIR/bin"
LIB_DIR="$PKG_DIR/lib"
mkdir -p "$BIN_DIR" "$LIB_DIR"

E2FS="$(brew --prefix e2fsprogs)"
GETTEXT="$(brew --prefix gettext)"
CELLAR_E2FS="$(readlink -f "$E2FS/sbin/mke2fs" | xargs dirname | xargs dirname)/lib"

cp "$E2FS/sbin/mke2fs" "$BIN_DIR/mke2fs"
chmod u+w "$BIN_DIR/mke2fs"

E2FS_LIBS=(libext2fs.2.1.dylib libcom_err.1.1.dylib libblkid.2.0.dylib libuuid.1.1.dylib libe2p.2.1.dylib)
for d in "${E2FS_LIBS[@]}"; do
  cp "$CELLAR_E2FS/$d" "$LIB_DIR/$d"
  chmod u+w "$LIB_DIR/$d"
done
cp "$GETTEXT/lib/libintl.8.dylib" "$LIB_DIR/libintl.8.dylib"
chmod u+w "$LIB_DIR/libintl.8.dylib"

# Rewrite the binary's references.
for d in "${E2FS_LIBS[@]}"; do
  install_name_tool -change "$CELLAR_E2FS/$d" "@loader_path/../lib/$d" "$BIN_DIR/mke2fs"
done
install_name_tool -change "$GETTEXT/lib/libintl.8.dylib" "@loader_path/../lib/libintl.8.dylib" "$BIN_DIR/mke2fs"

# Rewrite each dylib's own install-name.
for d in "${E2FS_LIBS[@]}" libintl.8.dylib; do
  install_name_tool -id "@loader_path/$d" "$LIB_DIR/$d"
done

# Re-sign (ad-hoc) to satisfy Apple Silicon dyld.
codesign --force --sign - "$BIN_DIR/mke2fs" "$LIB_DIR"/*.dylib

echo "--- bundled deps ---"
otool -L "$BIN_DIR/mke2fs"
"$BIN_DIR/mke2fs" -V
echo "Wrote $BIN_DIR/mke2fs"
