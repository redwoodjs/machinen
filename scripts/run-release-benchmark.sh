#!/usr/bin/env bash
# Run and publish one official Darwin arm64/HVF release baseline.
# The benchmark uses the exact source tag, public base assets, and npm native
# package from that release. Publishing is idempotent unless --force is used.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOURCE_REPO=${MACHINEN_SOURCE_REPO:-redwoodjs/machinen}
BENCHMARK_REPO=${MACHINEN_BENCHMARK_REPO:-redwoodjs/machinen-benchmarks}
SAMPLES=${MACHINEN_BENCHMARK_SAMPLES:-5}
OUTPUT_ROOT=${MACHINEN_BENCHMARK_OUTPUT_ROOT:-$ROOT/bench-results/release-baselines}
FORCE=0
REPLACE=0

usage() {
  echo "usage: run-release-benchmark.sh [--force] <version>" >&2
  exit 2
}

if [[ ${1:-} == "--force" ]]; then
  FORCE=1
  shift
fi
[[ $# -eq 1 ]] || usage
VERSION=${1#runtime-v}
VERSION=${VERSION#v}
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
[[ $SAMPLES =~ ^[1-9][0-9]*$ ]] || { echo "invalid sample count: $SAMPLES" >&2; exit 2; }

SOURCE_TAG="runtime-v${VERSION}"
BASELINE_TAG="baseline-v${VERSION}-darwin-arm64-arm64-hvf"
OUTPUT_DIR="$OUTPUT_ROOT/$VERSION"

if gh release view "$BASELINE_TAG" --repo "$BENCHMARK_REPO" >/dev/null 2>&1; then
  if [[ $FORCE -eq 0 ]]; then
    echo "release-benchmark: $BASELINE_TAG already exists; skipping"
    exit 0
  fi
  REPLACE=1
  echo "release-benchmark: $BASELINE_TAG will be replaced after the new run succeeds"
fi

gh release view "$SOURCE_TAG" --repo "$SOURCE_REPO" >/dev/null
command -v git >/dev/null
command -v gh >/dev/null
command -v npm >/dev/null
command -v pnpm >/dev/null
command -v node >/dev/null

SCRATCH=$(mktemp -d -t machinen-release-benchmark.XXXXXX)
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  pkill -f "$SCRATCH/source/packages/native-arm64-darwin/vmm/bin/machinen-vm" 2>/dev/null || true
  pkill -f "$SCRATCH/source/packages/native-arm64-darwin/vmm/bin/gvproxy" 2>/dev/null || true
  rm -rf "$SCRATCH"
  exit "$status"
}
trap cleanup EXIT INT TERM

SOURCE="$SCRATCH/source"
ASSETS="$SOURCE/release-assets"
NATIVE="$SOURCE/packages/native-arm64-darwin"
RAW="$SCRATCH/bench-v${VERSION}.json"
PACKAGE="$SCRATCH/package"

printf 'release-benchmark: preparing Machinen v%s in %s\n' "$VERSION" "$SOURCE"
git clone --quiet --no-checkout "$ROOT" "$SOURCE"
git -C "$SOURCE" checkout --quiet --detach "$SOURCE_TAG"
if [[ $(git -C "$SOURCE" rev-parse HEAD) != $(gh api "repos/$SOURCE_REPO/git/ref/tags/$SOURCE_TAG" --jq .object.sha) ]]; then
  echo "release-benchmark: local $SOURCE_TAG does not match GitHub" >&2
  exit 1
fi

mkdir -p "$ASSETS"
gh release download "$SOURCE_TAG" --repo "$SOURCE_REPO" --dir "$ASSETS" \
  --pattern Image-arm64 \
  --pattern Image-arm64.sha256 \
  --pattern virt-arm64.dtb \
  --pattern virt-arm64.dtb.sha256 \
  --pattern rootfs-debian-arm64.tar.gz \
  --pattern rootfs-debian-arm64.tar.gz.sha256

printf 'release-benchmark: installing dependencies and released native package\n'
(
  cd "$SOURCE"
  pnpm install --frozen-lockfile
)
NATIVE_TARBALL=$(npm pack "@machinen/native-arm64-darwin@${VERSION}" \
  --pack-destination "$SCRATCH" --silent)
mkdir -p "$PACKAGE"
tar -xzf "$SCRATCH/$NATIVE_TARBALL" -C "$PACKAGE"
rm -rf "$NATIVE/vmm"
cp -R "$PACKAGE/package/vmm" "$NATIVE/vmm"
chmod +x "$NATIVE"/vmm/bin/*

(
  cd "$SOURCE"
  pnpm -F @machinen/runtime -F @machinen/cli build
)

printf 'release-benchmark: running n=%s all-suite baseline\n' "$SAMPLES"
(
  cd "$SOURCE"
  MACHINEN_VMM="$NATIVE/vmm/bin/machinen-vm" \
  MACHINEN_RUNTIME_HELPER="$NATIVE/vmm/bin/machinen-runtime-helper" \
  MACHINEN_PDEATHSIG="$NATIVE/vmm/bin/machinen-pdeathsig" \
  MACHINEN_PTY="$NATIVE/vmm/bin/machinen-pty" \
  MACHINEN_WINSIZE="$NATIVE/vmm/bin/machinen-winsize" \
  MACHINEN_GVPROXY="$NATIVE/vmm/bin/gvproxy" \
  pnpm bench --n "$SAMPLES" --suite all --guest-arch arm64 --json "$RAW"
)

rm -rf "$OUTPUT_DIR"
node "$ROOT/scripts/package-release-benchmark.mjs" "$VERSION" "$RAW" "$OUTPUT_DIR"

printf 'release-benchmark: publishing %s\n' "$BASELINE_TAG"
if [[ $REPLACE -eq 1 ]]; then
  gh release delete "$BASELINE_TAG" --repo "$BENCHMARK_REPO" --cleanup-tag --yes
fi
gh release create "$BASELINE_TAG" \
  --repo "$BENCHMARK_REPO" \
  --target main \
  --title "Machinen v${VERSION} baseline — darwin arm64 / arm64 / HVF" \
  --notes-file "$OUTPUT_DIR/summary.md" \
  "$OUTPUT_DIR"/*.json.gz \
  "$OUTPUT_DIR/metadata.json" \
  "$OUTPUT_DIR/summary.md"

echo "release-benchmark: published https://github.com/$BENCHMARK_REPO/releases/tag/$BASELINE_TAG"
