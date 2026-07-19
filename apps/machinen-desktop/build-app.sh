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

app="Machinen.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/MachinenDesktop" "$app/Contents/MacOS/Machinen"
while IFS= read -r -d '' bundle; do
    cp -R "$bundle" "$app/Contents/Resources/"
done < <(find "$bin_dir" -maxdepth 1 -type d -name '*.bundle' -print0)
cp Resources/Info.plist "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"

codesign --force --deep --sign - "$app"
echo "Built $PWD/$app"
