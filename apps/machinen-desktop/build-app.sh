#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

configuration="${1:-debug}"
case "$configuration" in
    debug|release) ;;
    *)
        echo "usage: ./build-app.sh [debug|release]" >&2
        exit 2
        ;;
esac

repo_root="$(cd ../.. && pwd)"
services_package="$repo_root/apps/machinen-desktop-services"
session_package="$repo_root/packages/session"
node_executable="$(node -p 'process.execPath')"
node_license="$(dirname "$node_executable")/../LICENSE"
[[ -x "$node_executable" ]] || { echo "Node executable is missing: $node_executable" >&2; exit 1; }
[[ -f "$node_license" ]] || { echo "Node license is missing: $node_license" >&2; exit 1; }

pnpm -F @machinen/desktop-services build
./prepare-ghostty.sh
swift build -c "$configuration"
bin_dir="$(swift build -c "$configuration" --show-bin-path)"
(
    cd "$session_package"
    zig build -Doptimize=ReleaseSmall
    zig build -Dtarget=aarch64-linux-musl -Doptimize=ReleaseSmall --prefix zig-out-bundle-aarch64-linux
    zig build -Dtarget=x86_64-linux-musl -Doptimize=ReleaseSmall --prefix zig-out-bundle-x86_64-linux
)

app="Machinen.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Helpers" "$app/Contents/Resources"
cp "$bin_dir/MachinenDesktop" "$app/Contents/MacOS/Machinen"
cp "$node_executable" "$app/Contents/Helpers/node"
cp "$session_package/zig-out/bin/machinen-session" "$app/Contents/Helpers/machinen-session"
cp "$session_package/zig-out-bundle-aarch64-linux/bin/machinen-session" \
    "$app/Contents/Helpers/machinen-session-aarch64-linux"
cp "$session_package/zig-out-bundle-x86_64-linux/bin/machinen-session" \
    "$app/Contents/Helpers/machinen-session-x86_64-linux"
while IFS= read -r -d '' bundle; do
    cp -R "$bundle" "$app/Contents/Resources/"
done < <(find "$bin_dir" -maxdepth 1 -type d -name '*.bundle' -print0)
mkdir -p "$app/Contents/Resources/DesktopServices"
cp "$services_package/dist/index.js" "$app/Contents/Resources/DesktopServices/index.js"
printf '{"private":true,"type":"module"}\n' \
    > "$app/Contents/Resources/DesktopServices/package.json"
cp Resources/Info.plist "$app/Contents/Info.plist"
cp Dependencies/GHOSTTY-LICENSE "$app/Contents/Resources/GHOSTTY-LICENSE"
cp "$node_license" "$app/Contents/Resources/NODE-LICENSE"
printf 'APPL????' > "$app/Contents/PkgInfo"

codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "Built $PWD/$app"
