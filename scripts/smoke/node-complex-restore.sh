#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
VERSIONS=${PORTABLE_NODE_COMPLEX_VERSIONS:-18,20,22,24}
WORK=${PORTABLE_NODE_COMPLEX_WORK_DIR:-}
JSON=0
KEEP=0

usage() {
  echo "usage: bash scripts/smoke/node-complex-restore.sh [--json] [--keep] [--work-dir path]" >&2
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

log() { if [[ $JSON -eq 0 ]]; then echo "node-complex-restore: $*"; fi; }

ssh -o BatchMode=yes -o ConnectTimeout=5 "$ARM64_SSH" true >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 "$AMD64_SSH" true >/dev/null
ssh "$ARM64_SSH" 'docker info >/dev/null 2>&1'
ssh "$AMD64_SSH" 'docker info >/dev/null 2>&1'

stage_script() {
  local dest=$1
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "$ROOT/scripts/node-complex-restore-proof.mjs" "$dest/"
}

remote_node_run() {
  local host=$1 image=$2 remote_dir=$3 command=$4
  ssh "$host" "docker run --rm -e NPM_CONFIG_USERCONFIG=/dev/null -v '$remote_dir':'/work' -w /work '$image' bash -lc 'apt-get update >/dev/null && apt-get install -y --no-install-recommends file gcc g++ make python3 openssl sqlite3 redis-server redis-tools >/dev/null && $command'"
}

run_route() {
  local version=$1 source_host=$2 target_host=$3 source_label=$4 target_label=$5 route_label=$6
  local image="node:${version}-bookworm"
  local source_stage="$WORK/source-${route_label}-node${version}"
  stage_script "$source_stage"
  log "capturing complex Node source ${route_label} Node $version"
  tar --no-xattrs -czf - -C "$source_stage" . | ssh "$source_host" "rm -rf /tmp/machinen-complex-node-source-${route_label}-${version}-$$ && mkdir -p /tmp/machinen-complex-node-source-${route_label}-${version}-$$ && tar -xzf - -C /tmp/machinen-complex-node-source-${route_label}-${version}-$$"
  remote_node_run "$source_host" "$image" "/tmp/machinen-complex-node-source-${route_label}-${version}-$$" "node node-complex-restore-proof.mjs run-suite --role source --host-label '$source_label' --version-label node-$version --out /work/source.json --work-dir /tmp/complex-source-${route_label}-${version}-$$"
  ssh "$source_host" "cat /tmp/machinen-complex-node-source-${route_label}-${version}-$$/source.json" >"$WORK/source-${route_label}-node${version}.json"

  local target_stage="$WORK/target-${route_label}-node${version}"
  stage_script "$target_stage"
  mkdir -p "$target_stage/source"
  cp "$WORK/source-${route_label}-node${version}.json" "$target_stage/source/source.json"
  log "restoring complex Node target ${route_label} Node $version"
  tar --no-xattrs -czf - -C "$target_stage" . | ssh "$target_host" "rm -rf /tmp/machinen-complex-node-target-${route_label}-${version}-$$ && mkdir -p /tmp/machinen-complex-node-target-${route_label}-${version}-$$ && tar -xzf - -C /tmp/machinen-complex-node-target-${route_label}-${version}-$$"
  remote_node_run "$target_host" "$image" "/tmp/machinen-complex-node-target-${route_label}-${version}-$$" "node node-complex-restore-proof.mjs run-suite --role target --host-label '$target_label' --version-label node-$version --source-suite /work/source/source.json --out /work/target.json --work-dir /tmp/complex-target-${route_label}-${version}-$$"
  ssh "$target_host" "cat /tmp/machinen-complex-node-target-${route_label}-${version}-$$/target.json" >"$WORK/target-${route_label}-node${version}.json"
}

IFS=, read -r -a VERSION_LIST <<<"$VERSIONS"
for version in "${VERSION_LIST[@]}"; do
  run_route "$version" "$ARM64_SSH" "$AMD64_SSH" "remote-builder-arm64-complex" "proxmox-amd64-complex" "arm64-to-amd64"
  run_route "$version" "$AMD64_SSH" "$ARM64_SSH" "proxmox-amd64-complex" "remote-builder-arm64-complex" "amd64-to-arm64"
done

node --input-type=module - "$WORK" "$VERSIONS" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [work, versionsCsv] = process.argv.slice(2);
const routes = [];
for (const version of versionsCsv.split(',')) {
  for (const route of ['arm64-to-amd64', 'amd64-to-arm64']) {
    const source = JSON.parse(readFileSync(`${work}/source-${route}-node${version}.json`, 'utf8'));
    const target = JSON.parse(readFileSync(`${work}/target-${route}-node${version}.json`, 'utf8'));
    routes.push({
      name: `${route}-node${version}`,
      version: `node-${version}`,
      state: target.state,
      sourceState: source.state,
      route: target.route,
      targetRestore: target.targetRestore,
      securityInspection: target.targetArtifacts.securityInspection,
      refusalCount: target.refusals.length,
      summary: target,
    });
  }
}
const completedRoutes = routes.filter((route) => route.state === 'completed').length;
const assertions = {
  frameworkApps: routes.every((route) => route.targetRestore.frameworkResult === 'passed'),
  persistence: routes.every((route) => route.targetRestore.persistenceResult === 'passed'),
  networking: routes.every((route) => route.targetRestore.networkingResult === 'passed'),
  topology: routes.every((route) => route.targetRestore.topologyResult === 'passed'),
  publishedNative: routes.every((route) => route.targetRestore.publishedNativeResult === 'passed'),
  loadFailure: routes.every((route) => route.targetRestore.loadFailureResult === 'passed'),
  osRuntimeMatrix: routes.every((route) => route.targetRestore.osRuntimeMatrixResult === 'passed'),
  bidirectional: routes.some((route) => route.route.sourceToTarget === 'arm64->x64') && routes.some((route) => route.route.sourceToTarget === 'x64->arm64'),
  noShortcutArtifacts: routes.every((route) => route.securityInspection.passed === true),
};
const output = {
  kind: 'machinen.complex-node-restore-smoke',
  state: completedRoutes === routes.length && Object.values(assertions).every(Boolean) ? 'completed' : 'failed',
  routeCount: routes.length,
  completedRoutes,
  versions: versionsCsv.split(','),
  routes,
  assertions,
};
writeFileSync(`${work}/summary.json`, `${JSON.stringify(output, null, 2)}\n`);
process.exit(output.state === 'completed' ? 0 : 1);
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node --input-type=module - "$WORK/summary.json" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(`node-complex-restore: ${summary.state} ${summary.completedRoutes}/${summary.routeCount} bidirectional routes; versions=${summary.versions.join(',')}`);
NODE
fi
