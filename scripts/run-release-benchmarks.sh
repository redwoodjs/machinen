#!/usr/bin/env bash
# Reconcile official Darwin arm64/HVF baselines with published runtime releases.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOURCE_REPO=${MACHINEN_SOURCE_REPO:-redwoodjs/machinen}
BENCHMARK_REPO=${MACHINEN_BENCHMARK_REPO:-redwoodjs/machinen-benchmarks}
FORCE_ARG=()

if [[ ${1:-} == "--force" ]]; then
  FORCE_ARG=(--force)
  shift
fi

normalize_versions() {
  tr ', ' '\n' | sed -E 's/^runtime-v//; s/^v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | \
    awk -F. '($1 > 0) || ($1 == 0 && $2 >= 6)' | sort -t. -k1,1n -k2,2n -k3,3n -u
}

if [[ $# -gt 0 ]]; then
  versions=$(printf '%s\n' "$@" | normalize_versions)
else
  versions=$(gh release list --repo "$SOURCE_REPO" --limit 100 \
    --json tagName,isDraft,isPrerelease \
    --jq '.[] | select(.isDraft == false and .isPrerelease == false) | .tagName' | \
    normalize_versions)
fi

if [[ -z $versions ]]; then
  echo "release-benchmarks: no runtime releases found"
  exit 0
fi

ran=0
while IFS= read -r version; do
  baseline="baseline-v${version}-darwin-arm64-arm64-hvf"
  if [[ ${#FORCE_ARG[@]} -eq 0 ]] && \
    gh release view "$baseline" --repo "$BENCHMARK_REPO" >/dev/null 2>&1; then
    echo "release-benchmarks: $baseline already exists"
    continue
  fi
  if [[ ${#FORCE_ARG[@]} -eq 1 ]]; then
    "$ROOT/scripts/run-release-benchmark.sh" --force "$version"
  else
    "$ROOT/scripts/run-release-benchmark.sh" "$version"
  fi
  ran=$((ran + 1))
done <<< "$versions"

echo "release-benchmarks: published $ran baseline(s)"
