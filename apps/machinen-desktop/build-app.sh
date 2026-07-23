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

swift build -c "$configuration"
bin_dir="$(swift build -c "$configuration" --show-bin-path)"
session_package="$(cd ../.. && pwd)/packages/session"
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
cp "$session_package/zig-out/bin/machinen-session" "$app/Contents/Helpers/machinen-session"
cp "$session_package/zig-out-bundle-aarch64-linux/bin/machinen-session" \
    "$app/Contents/Helpers/machinen-session-aarch64-linux"
cp "$session_package/zig-out-bundle-x86_64-linux/bin/machinen-session" \
    "$app/Contents/Helpers/machinen-session-x86_64-linux"
while IFS= read -r -d '' bundle; do
    cp -R "$bundle" "$app/Contents/Resources/"
done < <(find "$bin_dir" -maxdepth 1 -type d -name '*.bundle' -print0)
cp Resources/Info.plist "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"

codesign --force --deep --sign - "$app"
echo "Built $PWD/$app"
