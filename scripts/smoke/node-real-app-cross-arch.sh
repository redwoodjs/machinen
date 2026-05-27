#!/usr/bin/env bash
set -euo pipefail

export COPYFILE_DISABLE=1

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
DOCKER_IMAGE=${PORTABLE_NODE_DOCKER_IMAGE:-node:24-bookworm}
SOURCE_SET=${PORTABLE_NODE_SOURCE_SET:-all}
WORK=${PORTABLE_NODE_CROSS_ARCH_WORK_DIR:-}
KEEP=0
JSON=0

usage() {
  echo "usage: bash scripts/smoke/node-real-app-cross-arch.sh [--json] [--keep] [--work-dir path] [--source local|remote-builder|all]" >&2
  exit 2
}

while (($# > 0)); do
  case "$1" in
    --) shift ;;
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir)
      shift
      [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage
      WORK=$1
      shift
      ;;
    --source)
      shift
      [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage
      SOURCE_SET=$1
      shift
      ;;
    *) usage ;;
  esac
done

case "$SOURCE_SET" in
  local|remote-builder|all) ;;
  *) usage ;;
esac

if [[ -z "$WORK" ]]; then
  WORK=$(mktemp -d)
else
  rm -rf "$WORK"
  mkdir -p "$WORK"
fi
STAGE="$WORK/stage"
SUMMARY="$WORK/summary.json"
mkdir -p "$STAGE/scripts/fixtures" "$STAGE/scripts/smoke"
cp "$ROOT/scripts/node-real-app-cross-arch-smoke.mjs" "$STAGE/scripts/"
cp "$ROOT/scripts/portable-machine-proof-profiles.json" "$STAGE/scripts/"
cp -R "$ROOT/scripts/fixtures/node-apps" "$STAGE/scripts/fixtures/"

cleanup() {
  if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

log() {
  if [[ $JSON -eq 0 ]]; then echo "node-real-app-cross-arch: $*"; fi
}

require_ssh() {
  local host=$1 label=$2
  if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$host" true >/dev/null 2>&1; then
    echo "node-real-app-cross-arch: FAIL — cannot reach $label ($host)" >&2
    exit 1
  fi
}

require_ssh "$AMD64_SSH" "amd64 target"
if [[ "$SOURCE_SET" == "remote-builder" || "$SOURCE_SET" == "all" ]]; then
  require_ssh "$ARM64_SSH" "arm64 remote builder"
  if ! ssh "$ARM64_SSH" 'docker info >/dev/null 2>&1' >/dev/null 2>&1; then
    echo "node-real-app-cross-arch: FAIL — $ARM64_SSH cannot run Docker" >&2
    exit 1
  fi
fi
if ! ssh "$AMD64_SSH" 'docker info >/dev/null 2>&1' >/dev/null 2>&1; then
  echo "node-real-app-cross-arch: FAIL — $AMD64_SSH cannot run Docker" >&2
  exit 1
fi

TARGET_REMOTE_WORK="/tmp/machinen-node-real-app-target-$$"
log "running amd64 target suite on $AMD64_SSH via $DOCKER_IMAGE"
tar --no-xattrs -czf - -C "$STAGE" . | ssh "$AMD64_SSH" "rm -rf '$TARGET_REMOTE_WORK' && mkdir -p '$TARGET_REMOTE_WORK' && tar -xzf - -C '$TARGET_REMOTE_WORK'"
ssh "$AMD64_SSH" "docker run --rm -v '$TARGET_REMOTE_WORK':'/work' -w /work '$DOCKER_IMAGE' node scripts/node-real-app-cross-arch-smoke.mjs run-suite --role target --host-label proxmox-amd64 --repo-root /work --out /work/target-suite.json"
ssh "$AMD64_SSH" "cat '$TARGET_REMOTE_WORK/target-suite.json'" >"$WORK/target-suite.json"

SOURCE_SUMMARIES=()
if [[ "$SOURCE_SET" == "local" || "$SOURCE_SET" == "all" ]]; then
  log "running local source suite"
  node "$ROOT/scripts/node-real-app-cross-arch-smoke.mjs" run-suite \
    --role source \
    --host-label local-arm64 \
    --repo-root "$ROOT" \
    --out "$WORK/source-local-suite.json"
  node "$ROOT/scripts/node-real-app-cross-arch-smoke.mjs" compare \
    --source "$WORK/source-local-suite.json" \
    --target "$WORK/target-suite.json" \
    --out "$WORK/summary-local-to-proxmox.json"
  SOURCE_SUMMARIES+=("$WORK/summary-local-to-proxmox.json")
fi

if [[ "$SOURCE_SET" == "remote-builder" || "$SOURCE_SET" == "all" ]]; then
  REMOTE_SOURCE_WORK="/tmp/machinen-node-real-app-source-$$"
  log "running arm64 remote-builder source suite on $ARM64_SSH via $DOCKER_IMAGE"
  tar --no-xattrs -czf - -C "$STAGE" . | ssh "$ARM64_SSH" "rm -rf '$REMOTE_SOURCE_WORK' && mkdir -p '$REMOTE_SOURCE_WORK' && tar -xzf - -C '$REMOTE_SOURCE_WORK'"
  ssh "$ARM64_SSH" "docker run --rm -v '$REMOTE_SOURCE_WORK':'/work' -w /work '$DOCKER_IMAGE' node scripts/node-real-app-cross-arch-smoke.mjs run-suite --role source --host-label remote-builder-arm64 --repo-root /work --out /work/source-suite.json"
  ssh "$ARM64_SSH" "cat '$REMOTE_SOURCE_WORK/source-suite.json'" >"$WORK/source-remote-builder-suite.json"
  node "$ROOT/scripts/node-real-app-cross-arch-smoke.mjs" compare \
    --source "$WORK/source-remote-builder-suite.json" \
    --target "$WORK/target-suite.json" \
    --out "$WORK/summary-remote-builder-to-proxmox.json"
  SOURCE_SUMMARIES+=("$WORK/summary-remote-builder-to-proxmox.json")
fi

node --input-type=module - "$SUMMARY" "${SOURCE_SUMMARIES[@]}" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [summaryPath, ...summaryFiles] = process.argv.slice(2);
const routes = summaryFiles.map((file) => JSON.parse(readFileSync(file, 'utf8')));
const profileCount = routes.reduce((count, route) => count + route.profileCount, 0);
const completedProfileCount = routes.reduce(
  (count, route) => count + route.profiles.filter((profile) => profile.pass).length,
  0,
);
const summary = {
  kind: 'machinen.node-real-app-cross-arch-smoke',
  state: routes.every((route) => route.pass) ? 'completed' : 'failed',
  pass: routes.every((route) => route.pass),
  routeCount: routes.length,
  profileCount,
  completedProfileCount,
  routes,
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
process.exit(summary.pass ? 0 : 1);
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$SUMMARY"
else
  node --input-type=module - "$SUMMARY" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`node-real-app-cross-arch: ${summary.state} ${summary.completedProfileCount}/${summary.profileCount} profiles across ${summary.routeCount} route(s)`);
NODE
fi
