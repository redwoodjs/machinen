#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
VERSIONS=${PORTABLE_NODE_ECOSYSTEM_VERSIONS:-18,20,22,24}
WORK=${PORTABLE_NODE_ECOSYSTEM_WORK_DIR:-}
JSON=0
KEEP=0

usage() {
  echo "usage: bash scripts/smoke/node-ecosystem-restore.sh [--json] [--keep] [--work-dir path]" >&2
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

log() { if [[ $JSON -eq 0 ]]; then echo "node-ecosystem-restore: $*"; fi; }

ssh -o BatchMode=yes -o ConnectTimeout=5 "$ARM64_SSH" true >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 "$AMD64_SSH" true >/dev/null
ssh "$ARM64_SSH" 'docker info >/dev/null 2>&1'
ssh "$AMD64_SSH" 'docker info >/dev/null 2>&1'

stage_tree() {
  local dest=$1
  rm -rf "$dest"
  mkdir -p "$dest/scripts/fixtures"
  cp "$ROOT/scripts/node-ecosystem-restore-proof.mjs" "$dest/scripts/"
  cp -R "$ROOT/scripts/fixtures/node-ecosystem-registry" "$dest/scripts/fixtures/"
}

remote_node_run() {
  local host=$1 image=$2 remote_dir=$3 command=$4
  ssh "$host" "docker run --rm -e NPM_CONFIG_USERCONFIG=/dev/null -e NPM_CONFIG_IGNORE_SCRIPTS=true -e NPM_CONFIG_REGISTRY=http://127.0.0.1:9/ -v '$remote_dir':'/work' -w /work '$image' bash -lc 'apt-get update >/dev/null && apt-get install -y --no-install-recommends file gcc g++ make python3 >/dev/null && $command'"
}

run_route() {
  local version=$1 source_host=$2 target_host=$3 source_label=$4 target_label=$5 route_label=$6
  local image="node:${version}-bookworm"
  local source_stage="$WORK/source-${route_label}-node${version}"
  stage_tree "$source_stage"
  log "capturing audited ecosystem source ${route_label} Node $version"
  tar --no-xattrs -czf - -C "$source_stage" . | ssh "$source_host" "rm -rf /tmp/machinen-ecosystem-node-source-${route_label}-${version}-$$ && mkdir -p /tmp/machinen-ecosystem-node-source-${route_label}-${version}-$$ && tar -xzf - -C /tmp/machinen-ecosystem-node-source-${route_label}-${version}-$$"
  remote_node_run "$source_host" "$image" "/tmp/machinen-ecosystem-node-source-${route_label}-${version}-$$" "node scripts/node-ecosystem-restore-proof.mjs run-suite --role source --host-label '$source_label' --version-label node-$version --out /work/source.json --work-dir /tmp/ecosystem-source-${route_label}-${version}-$$"
  ssh "$source_host" "cat /tmp/machinen-ecosystem-node-source-${route_label}-${version}-$$/source.json" >"$WORK/source-${route_label}-node${version}.json"

  local target_stage="$WORK/target-${route_label}-node${version}"
  stage_tree "$target_stage"
  mkdir -p "$target_stage/source"
  cp "$WORK/source-${route_label}-node${version}.json" "$target_stage/source/source.json"
  log "restoring audited ecosystem target ${route_label} Node $version"
  tar --no-xattrs -czf - -C "$target_stage" . | ssh "$target_host" "rm -rf /tmp/machinen-ecosystem-node-target-${route_label}-${version}-$$ && mkdir -p /tmp/machinen-ecosystem-node-target-${route_label}-${version}-$$ && tar -xzf - -C /tmp/machinen-ecosystem-node-target-${route_label}-${version}-$$"
  remote_node_run "$target_host" "$image" "/tmp/machinen-ecosystem-node-target-${route_label}-${version}-$$" "node scripts/node-ecosystem-restore-proof.mjs run-suite --role target --host-label '$target_label' --version-label node-$version --source-suite /work/source/source.json --out /work/target.json --work-dir /tmp/ecosystem-target-${route_label}-${version}-$$"
  ssh "$target_host" "cat /tmp/machinen-ecosystem-node-target-${route_label}-${version}-$$/target.json" >"$WORK/target-${route_label}-node${version}.json"
}

IFS=, read -r -a VERSION_LIST <<<"$VERSIONS"
for version in "${VERSION_LIST[@]}"; do
  run_route "$version" "$ARM64_SSH" "$AMD64_SSH" "remote-builder-arm64-ecosystem" "proxmox-amd64-ecosystem" "arm64-to-amd64"
  run_route "$version" "$AMD64_SSH" "$ARM64_SSH" "proxmox-amd64-ecosystem" "remote-builder-arm64-ecosystem" "amd64-to-arm64"
done

node --input-type=module - "$WORK" "$VERSIONS" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [work, versionsCsv] = process.argv.slice(2);
const routes = [];
for (const version of versionsCsv.split(',')) {
  for (const route of ['arm64-to-amd64', 'amd64-to-arm64']) {
    const target = JSON.parse(readFileSync(`${work}/target-${route}-node${version}.json`, 'utf8'));
    routes.push({
      name: `${route}-node${version}`,
      version: `node-${version}`,
      state: target.state,
      route: target.route,
      targetRestore: target.targetRestore,
      sandbox: target.targetArtifacts.sandbox,
      securityInspection: target.targetArtifacts.securityInspection,
      refusalCount: target.refusals.length,
      summary: target,
    });
  }
}
const completedRoutes = routes.filter((route) => route.state === 'completed').length;
const assertions = {
  noThirdPartyFetch: routes.every((route) => route.securityInspection.thirdPartyFetchUsed === false),
  noThirdPartyInstall: routes.every((route) => route.securityInspection.thirdPartyInstallUsed === false),
  noLifecycleScripts: routes.every((route) => route.securityInspection.lifecycleScriptsExecuted === false),
  localRegistry: routes.every((route) => route.targetRestore.localRegistryResult === 'passed'),
  nativePrebuild: routes.every((route) => route.targetRestore.nativePrebuildResult === 'passed'),
  lockfileSbom: routes.every((route) => route.targetRestore.lockfileSbomResult === 'passed'),
  sandbox: routes.every((route) => route.targetRestore.sandboxResult === 'passed'),
  ecosystemApp: routes.every((route) => route.targetRestore.ecosystemAppResult === 'passed'),
  bidirectional: routes.some((route) => route.route.sourceArch === 'arm64' && route.route.targetArch === 'x64') && routes.some((route) => route.route.sourceArch === 'x64' && route.route.targetArch === 'arm64'),
  noShortcutArtifacts: routes.every((route) => route.securityInspection.passed === true),
};
const output = {
  kind: 'machinen.audited-node-ecosystem-restore-smoke',
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
console.log(`node-ecosystem-restore: ${summary.state} ${summary.completedRoutes}/${summary.routeCount} routes; versions=${summary.versions.join(',')}`);
NODE
fi
