#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
DOCKER_IMAGE=${PORTABLE_NODE_DOCKER_IMAGE:-node:24-bookworm}
WORK=${PORTABLE_NODE_LIVE_WORK_DIR:-}
JSON=0
KEEP=0

usage() {
  echo "usage: bash scripts/smoke/node-live-restore.sh [--json] [--keep] [--work-dir path]" >&2
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
    *) usage ;;
  esac
done

if [[ -z "$WORK" ]]; then
  WORK=$(mktemp -d)
else
  rm -rf "$WORK"
  mkdir -p "$WORK"
fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

log() { if [[ $JSON -eq 0 ]]; then echo "node-live-restore: $*"; fi; }

stage_tree() {
  local dest=$1
  rm -rf "$dest"
  mkdir -p "$dest/scripts/fixtures"
  cp "$ROOT/scripts/node-live-restore-smoke.mjs" "$dest/scripts/"
  cp "$ROOT/scripts/portable-machine-proof-profiles.json" "$dest/scripts/"
  cp -R "$ROOT/scripts/fixtures/node-apps" "$dest/scripts/fixtures/"
}

ssh -o BatchMode=yes -o ConnectTimeout=5 "$ARM64_SSH" true >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 "$AMD64_SSH" true >/dev/null
ssh "$ARM64_SSH" 'docker info >/dev/null 2>&1'
ssh "$AMD64_SSH" 'docker info >/dev/null 2>&1'

LOCAL_STAGE="$WORK/local-stage"
stage_tree "$LOCAL_STAGE"
log "capturing local arm64 live Node processes"
node "$ROOT/scripts/node-live-restore-smoke.mjs" run \
  --role source \
  --host-label local-arm64 \
  --repo-root "$ROOT" \
  --out "$WORK/source-local.json"

RB_STAGE="$WORK/rb-stage"
stage_tree "$RB_STAGE"
log "capturing remote-builder arm64 live Node processes"
tar --no-xattrs -czf - -C "$RB_STAGE" . | ssh "$ARM64_SSH" "rm -rf /tmp/machinen-node-live-rb-$$ && mkdir -p /tmp/machinen-node-live-rb-$$ && tar -xzf - -C /tmp/machinen-node-live-rb-$$"
ssh "$ARM64_SSH" "docker run --rm -v /tmp/machinen-node-live-rb-$$:/work -w /work '$DOCKER_IMAGE' node scripts/node-live-restore-smoke.mjs run --role source --host-label remote-builder-arm64 --repo-root /work --out /work/source.json"
ssh "$ARM64_SSH" "cat /tmp/machinen-node-live-rb-$$/source.json" >"$WORK/source-remote-builder.json"

for route in local remote-builder; do
  TARGET_STAGE="$WORK/target-$route"
  stage_tree "$TARGET_STAGE"
  mkdir -p "$TARGET_STAGE/source"
  cp "$WORK/source-$route.json" "$TARGET_STAGE/source/source.json"
  log "restoring $route source summary on Proxmox amd64 target"
  tar --no-xattrs -czf - -C "$TARGET_STAGE" . | ssh "$AMD64_SSH" "rm -rf /tmp/machinen-node-live-target-$route-$$ && mkdir -p /tmp/machinen-node-live-target-$route-$$ && tar -xzf - -C /tmp/machinen-node-live-target-$route-$$"
  ssh "$AMD64_SSH" "docker run --rm -v /tmp/machinen-node-live-target-$route-$$:/work -w /work '$DOCKER_IMAGE' node scripts/node-live-restore-smoke.mjs run --role target --host-label proxmox-amd64 --repo-root /work --source-suite /work/source/source.json --out /work/target.json"
  ssh "$AMD64_SSH" "cat /tmp/machinen-node-live-target-$route-$$/target.json" >"$WORK/target-$route.json"
done

node --input-type=module - "$WORK" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const work = process.argv[2];
const routes = ['local', 'remote-builder'].map((route) => {
  const target = JSON.parse(readFileSync(`${work}/target-${route}.json`, 'utf8'));
  return {
    route,
    sourceHost: target.results[0]?.sourceCapture?.hostLabel,
    targetHost: target.hostLabel,
    sourceArch: target.results[0]?.sourceCapture?.sourceArch,
    targetArch: target.node.arch,
    state: target.state,
    profileCount: target.profileCount,
    completedProfileCount: target.results.filter((result) => result.pass).length,
    target,
  };
});
const summary = {
  kind: 'machinen.node-live-restore',
  state: routes.every((route) => route.state === 'completed') ? 'completed' : 'failed',
  routeCount: routes.length,
  profileCount: routes.reduce((sum, route) => sum + route.profileCount, 0),
  completedProfileCount: routes.reduce((sum, route) => sum + route.completedProfileCount, 0),
  routes,
};
writeFileSync(`${work}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
process.exit(summary.state === 'completed' ? 0 : 1);
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node --input-type=module - "$WORK/summary.json" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`node-live-restore: ${summary.state} ${summary.completedProfileCount}/${summary.profileCount} profiles across ${summary.routeCount} routes`);
NODE
fi
