#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
readonly desktop_root="$PWD"

readonly ghostty_version="1.3.1"
readonly ghostty_commit="332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28"
readonly source_url="https://github.com/ghostty-org/ghostty/archive/${ghostty_commit}.tar.gz"
readonly source_sha256="49db8f7db265f53833e781d6084318b4cfab65f1ea6b6832b8a93df829481165"
readonly patch_sha256="3c6dcba0853c7e82dedc9aec784f6aac228a2da1853b5f5d4b1114b3b72250d9"
readonly metallib_sha256="6893dea958b8d89b58c0ccefb1bfdb589ba4bb0c6fd1a0d73fe38a1715650918"
readonly terminfo_sha256="707349400682f7e3d4e29792035847875fa55879672dfae39247b3d23eb58f91"
readonly zig_version="0.15.2"
readonly dependency_cache="${MACHINEN_DEPENDENCY_CACHE:-$HOME/Library/Caches/Machinen/build-dependencies}"
readonly ghostty_cache="$dependency_cache/ghostty-$ghostty_version-$ghostty_commit-$patch_sha256"
readonly source_archive="$dependency_cache/ghostty-$ghostty_commit.tar.gz"
readonly source_directory="$ghostty_cache/source"
readonly resource_directory="$ghostty_cache/resources"

verify_sha256() {
    local expected="$1"
    local path="$2"
    local actual
    actual="$(shasum -a 256 "$path" | awk '{print $1}')"
    if [[ "$actual" != "$expected" ]]; then
        echo "checksum mismatch for $path" >&2
        echo "expected: $expected" >&2
        echo "actual:   $actual" >&2
        return 1
    fi
}

download() {
    local url="$1"
    local output="$2"
    local expected="$3"
    if [[ -f "$output" ]]; then
        if verify_sha256 "$expected" "$output" 2>/dev/null; then
            return
        fi
        rm -f "$output"
    fi
    local temporary="$output.download"
    rm -f "$temporary"
    curl -fL --retry 3 --retry-delay 1 -o "$temporary" "$url"
    verify_sha256 "$expected" "$temporary"
    mv "$temporary" "$output"
}

host_arch="$(uname -m)"
case "$host_arch" in
    arm64)
        zig_arch="aarch64"
        swift_arch="arm64"
        zig_sha256="3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b"
        ;;
    x86_64)
        zig_arch="x86_64"
        swift_arch="x86_64"
        zig_sha256="375b6909fc1495d16fc2c7db9538f707456bfc3373b14ee83fdd3e22b3d43f7f"
        ;;
    *)
        echo "unsupported macOS architecture: $host_arch" >&2
        exit 1
        ;;
esac
readonly zig_arch swift_arch zig_sha256
readonly target="${zig_arch}-macos.13.0"
readonly slice="macos-${swift_arch}"
readonly artifact="$ghostty_cache/$slice/GhosttyKit.xcframework"

mkdir -p "$dependency_cache" "$ghostty_cache"
verify_sha256 "$patch_sha256" Dependencies/ghostty-machinen.patch
verify_sha256 "$metallib_sha256" Dependencies/Ghostty.metallib
verify_sha256 "$terminfo_sha256" Dependencies/xterm-ghostty

find_zig() {
    local candidate
    for candidate in \
        "${MACHINEN_GHOSTTY_ZIG:-}" \
        "/opt/homebrew/opt/zig@0.15/bin/zig" \
        "/usr/local/opt/zig@0.15/bin/zig" \
        "$(command -v zig 2>/dev/null || true)"
    do
        if [[ -n "$candidate" && -x "$candidate" ]] \
            && [[ "$($candidate version 2>/dev/null)" == "$zig_version" ]]; then
            printf '%s\n' "$candidate"
            return
        fi
    done

    local toolchain="$dependency_cache/zig-$zig_arch-macos-$zig_version"
    local archive="$dependency_cache/zig-$zig_arch-macos-$zig_version.tar.xz"
    download \
        "https://ziglang.org/download/$zig_version/zig-$zig_arch-macos-$zig_version.tar.xz" \
        "$archive" \
        "$zig_sha256"
    if [[ ! -x "$toolchain/zig" ]]; then
        rm -rf "$toolchain"
        tar -xJf "$archive" -C "$dependency_cache"
    fi
    printf '%s\n' "$toolchain/zig"
}

zig="$(find_zig)"
if [[ "$($zig version)" != "$zig_version" ]]; then
    echo "Ghostty requires Zig $zig_version, found $($zig version)" >&2
    exit 1
fi

if [[ ! -f "$source_directory/.machinen-patch-$patch_sha256" ]]; then
    download "$source_url" "$source_archive" "$source_sha256"
    temporary_source="$ghostty_cache/source.tmp.$$"
    rm -rf "$temporary_source"
    mkdir -p "$temporary_source"
    tar -xzf "$source_archive" --strip-components=1 -C "$temporary_source"
    (
        cd "$temporary_source"
        patch -p1 < "$desktop_root/Dependencies/ghostty-machinen.patch"
    )
    cp Dependencies/Ghostty.metallib "$temporary_source/src/renderer/shaders/Ghostty.metallib"
    touch "$temporary_source/.machinen-patch-$patch_sha256"
    rm -rf "$source_directory"
    mv "$temporary_source" "$source_directory"
fi

if [[ ! -s "$resource_directory/terminfo/78/xterm-ghostty" ]] \
    || [[ ! -d "$resource_directory/ghostty/shell-integration" ]]; then
    rm -rf "$resource_directory"
    mkdir -p "$resource_directory/terminfo/78" "$resource_directory/ghostty"
    cp Dependencies/xterm-ghostty "$resource_directory/terminfo/78/xterm-ghostty"
    cp -R "$source_directory/src/shell-integration" "$resource_directory/ghostty/"
fi

if [[ ! -s "$artifact/$slice/libghostty.a" ]]; then
    rm -rf "$source_directory/zig-out" "$artifact"
    (
        cd "$source_directory"
        "$zig" build machinen-lib \
            -Dxcframework-target=native \
            -Dtarget="$target" \
            -Dapp-runtime=none \
            -Doptimize=ReleaseFast
    )

    mkdir -p "$artifact/$slice/Headers"
    cp "$source_directory/zig-out/lib/libghostty.a" "$artifact/$slice/libghostty.a"
    cp "$source_directory/include/ghostty.h" "$artifact/$slice/Headers/ghostty.h"
    cp "$source_directory/include/module.modulemap" "$artifact/$slice/Headers/module.modulemap"
    cat > "$artifact/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AvailableLibraries</key>
  <array>
    <dict>
      <key>HeadersPath</key><string>Headers</string>
      <key>LibraryIdentifier</key><string>$slice</string>
      <key>LibraryPath</key><string>libghostty.a</string>
      <key>SupportedArchitectures</key><array><string>$swift_arch</string></array>
      <key>SupportedPlatform</key><string>macos</string>
    </dict>
  </array>
  <key>CFBundlePackageType</key><string>XFWK</string>
  <key>XCFrameworkFormatVersion</key><string>1.0</string>
</dict>
</plist>
EOF
    plutil -lint "$artifact/Info.plist" >/dev/null
fi

rm -rf Dependencies/GhosttyKit.xcframework Sources/MachinenDesktop/GhosttyResources
ln -s "$artifact" Dependencies/GhosttyKit.xcframework
cp -R "$resource_directory" Sources/MachinenDesktop/GhosttyResources

echo "Prepared Ghostty $ghostty_version for $swift_arch at $artifact"
