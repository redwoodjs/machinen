#!/usr/bin/env bash
# Build a relocatable mksquashfs bundle for arm64 darwin and drop it
# at bin/mksquashfs (+ lib/*.dylib).
#
# Same idiom as packages/e2fsprogs-arm64-darwin/scripts/build.sh: copy
# the brew binary, copy the dylib transitive closure alongside,
# rewrite install-name references to @loader_path, and re-sign because
# install_name_tool invalidates the ad-hoc signature.
#
# Prereq: `brew install squashfs` on the build host. squashfs depends
# on lz4, lzo, xz, and zstd (also keg-only / cellar-installed); we
# pull each transitively-linked dylib into lib/.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$PKG_DIR/bin"
LIB_DIR="$PKG_DIR/lib"
mkdir -p "$BIN_DIR" "$LIB_DIR"

SRC_BIN="$(brew --prefix squashfs)/bin/mksquashfs"
if [ ! -x "$SRC_BIN" ]; then
  echo "build: $SRC_BIN missing — run 'brew install squashfs' first" >&2
  exit 1
fi

cp "$SRC_BIN" "$BIN_DIR/mksquashfs"
chmod u+w "$BIN_DIR/mksquashfs"

# Resolve the transitive closure of non-system dylibs the binary
# loads. /usr/lib/libSystem-style deps stay system-resolved; everything
# else gets copied in and rewritten.
copy_and_rewrite() {
  local target="$1"
  local out_dir="$2"
  # `otool -L` lists each linked dylib on its own line. Skip lines
  # pointing at /usr/lib/* and /System/Library/* (system frameworks
  # — left alone) and the binary's own ID line.
  while read -r dep; do
    case "$dep" in
      /opt/homebrew/*|/usr/local/*)
        local name
        name="$(basename "$dep")"
        if [ ! -f "$out_dir/$name" ]; then
          cp "$dep" "$out_dir/$name"
          chmod u+w "$out_dir/$name"
          # Recurse — squashfs → zstd → libc++abi etc. covered by
          # the same prefix filter.
          copy_and_rewrite "$out_dir/$name" "$out_dir"
        fi
        install_name_tool -change "$dep" "@loader_path/$name" "$target" 2>/dev/null || true
        ;;
    esac
  done < <(otool -L "$target" | tail -n +2 | awk '{print $1}')
}

copy_and_rewrite "$BIN_DIR/mksquashfs" "$LIB_DIR"

# The binary itself loaded each lib through its full brew path; now
# the binary refers to @loader_path/../lib/<name>. The libs themselves
# still hold their old install names — fix those too so each lib's
# *id* is `@loader_path/<name>` and so any cross-lib references
# resolve via @loader_path.
for f in "$LIB_DIR"/*.dylib; do
  install_name_tool -id "@loader_path/$(basename "$f")" "$f" || true
done
# Now rewrite cross-lib references in each lib (libsquashfs may load
# liblzma which loads libsystem etc.).
for f in "$LIB_DIR"/*.dylib; do
  while read -r dep; do
    case "$dep" in
      /opt/homebrew/*|/usr/local/*)
        local_name="$(basename "$dep")"
        install_name_tool -change "$dep" "@loader_path/$local_name" "$f" 2>/dev/null || true
        ;;
    esac
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
done

# Update the binary path references one more time after recursion.
for f in "$BIN_DIR/mksquashfs" "$LIB_DIR"/*.dylib; do
  while read -r dep; do
    case "$dep" in
      /opt/homebrew/*|/usr/local/*)
        local_name="$(basename "$dep")"
        if [ "$f" = "$BIN_DIR/mksquashfs" ]; then
          install_name_tool -change "$dep" "@loader_path/../lib/$local_name" "$f" 2>/dev/null || true
        else
          install_name_tool -change "$dep" "@loader_path/$local_name" "$f" 2>/dev/null || true
        fi
        ;;
    esac
  done < <(otool -L "$f" | tail -n +2 | awk '{print $1}')
done

# Re-sign (ad-hoc) to satisfy Apple Silicon dyld.
codesign --force --sign - "$BIN_DIR/mksquashfs" "$LIB_DIR"/*.dylib

echo "--- bundled deps ---"
otool -L "$BIN_DIR/mksquashfs"
"$BIN_DIR/mksquashfs" -version | head -2 || true
echo "Wrote $BIN_DIR/mksquashfs"
