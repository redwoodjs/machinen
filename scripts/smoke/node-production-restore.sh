#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
WORK=${PORTABLE_NODE_PRODUCTION_WORK_DIR:-}
VERSIONS=${PORTABLE_NODE_PRODUCTION_VERSIONS:-20,22,24}
JSON=0
KEEP=0

usage() {
  echo "usage: bash scripts/smoke/node-production-restore.sh [--json] [--keep] [--work-dir path]" >&2
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

log() { if [[ $JSON -eq 0 ]]; then echo "node-production-restore: $*"; fi; }

ssh -o BatchMode=yes -o ConnectTimeout=5 "$ARM64_SSH" true >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 "$AMD64_SSH" true >/dev/null
ssh "$ARM64_SSH" 'docker info >/dev/null 2>&1'
ssh "$AMD64_SSH" 'docker info >/dev/null 2>&1'

stage_script() {
  local dest=$1
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "$ROOT/scripts/node-production-restore-proof.mjs" "$dest/"
}

remote_node_run() {
  local host=$1 image=$2 remote_dir=$3 command=$4
  ssh "$host" "docker run --rm -v '$remote_dir':'/work' -w /work '$image' bash -lc 'if ! command -v file >/dev/null 2>&1; then apt-get update >/dev/null && apt-get install -y --no-install-recommends file gcc g++ make >/dev/null; fi; $command'"
}

# Local production-shaped source route on the developer arm64 machine.
log "capturing local production-shaped Node service"
node "$ROOT/scripts/node-production-restore-proof.mjs" run-suite \
  --role source \
  --host-label local-arm64-production \
  --version-label local-node-$(node -p 'process.versions.node.split(".")[0]') \
  --out "$WORK/source-local.json" \
  --work-dir "$WORK/source-local-work"

LOCAL_TARGET_STAGE="$WORK/target-local"
stage_script "$LOCAL_TARGET_STAGE"
mkdir -p "$LOCAL_TARGET_STAGE/source"
cp "$WORK/source-local.json" "$LOCAL_TARGET_STAGE/source/source.json"
log "restoring local production source on Proxmox amd64"
tar --no-xattrs -czf - -C "$LOCAL_TARGET_STAGE" . | ssh "$AMD64_SSH" "rm -rf /tmp/machinen-prod-node-local-$$ && mkdir -p /tmp/machinen-prod-node-local-$$ && tar -xzf - -C /tmp/machinen-prod-node-local-$$"
remote_node_run "$AMD64_SSH" "node:$(node -p 'process.versions.node.split(".")[0]')-bookworm" "/tmp/machinen-prod-node-local-$$" "node node-production-restore-proof.mjs run-suite --role target --host-label proxmox-amd64-production --source-suite /work/source/source.json --out /work/target.json --work-dir /tmp/prod-target-local-$$"
ssh "$AMD64_SSH" "cat /tmp/machinen-prod-node-local-$$/target.json" >"$WORK/target-local.json"

IFS=, read -r -a VERSION_LIST <<<"$VERSIONS"
for version in "${VERSION_LIST[@]}"; do
  image="node:${version}-bookworm"
  source_stage="$WORK/source-rb-node$version"
  stage_script "$source_stage"
  log "capturing remote-builder production source with Node $version"
  tar --no-xattrs -czf - -C "$source_stage" . | ssh "$ARM64_SSH" "rm -rf /tmp/machinen-prod-node-rb-$version-$$ && mkdir -p /tmp/machinen-prod-node-rb-$version-$$ && tar -xzf - -C /tmp/machinen-prod-node-rb-$version-$$"
  remote_node_run "$ARM64_SSH" "$image" "/tmp/machinen-prod-node-rb-$version-$$" "node node-production-restore-proof.mjs run-suite --role source --host-label remote-builder-arm64-production --version-label node-$version --out /work/source.json --work-dir /tmp/prod-source-rb-$version-$$"
  ssh "$ARM64_SSH" "cat /tmp/machinen-prod-node-rb-$version-$$/source.json" >"$WORK/source-rb-node$version.json"

  target_stage="$WORK/target-rb-node$version"
  stage_script "$target_stage"
  mkdir -p "$target_stage/source"
  cp "$WORK/source-rb-node$version.json" "$target_stage/source/source.json"
  log "restoring remote-builder Node $version production source on Proxmox amd64"
  tar --no-xattrs -czf - -C "$target_stage" . | ssh "$AMD64_SSH" "rm -rf /tmp/machinen-prod-node-target-$version-$$ && mkdir -p /tmp/machinen-prod-node-target-$version-$$ && tar -xzf - -C /tmp/machinen-prod-node-target-$version-$$"
  remote_node_run "$AMD64_SSH" "$image" "/tmp/machinen-prod-node-target-$version-$$" "node node-production-restore-proof.mjs run-suite --role target --host-label proxmox-amd64-production --version-label node-$version --source-suite /work/source/source.json --out /work/target.json --work-dir /tmp/prod-target-rb-$version-$$"
  ssh "$AMD64_SSH" "cat /tmp/machinen-prod-node-target-$version-$$/target.json" >"$WORK/target-rb-node$version.json"
done

node --input-type=module - "$WORK" "$VERSIONS" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [work, versionsCsv] = process.argv.slice(2);
const routes = [];
const local = JSON.parse(readFileSync(`${work}/target-local.json`, 'utf8'));
routes.push({ name: 'local-current-to-proxmox', version: local.versionLabel, state: local.state, summary: local });
for (const version of versionsCsv.split(',')) {
  const summary = JSON.parse(readFileSync(`${work}/target-rb-node${version}.json`, 'utf8'));
  routes.push({ name: `remote-builder-node${version}-to-proxmox-node${version}`, version: `node-${version}`, state: summary.state, summary });
}
const completedRoutes = routes.filter((route) => route.state === 'completed').length;
const refusalFamilies = routes.flatMap((route) => route.summary.refusals ?? []);
const output = {
  kind: 'machinen.production-node-restore',
  state: completedRoutes === routes.length ? 'completed' : 'failed',
  routeCount: routes.length,
  completedRoutes,
  routes,
  refusalFamilies,
  securityInspectionPassed: routes.every((route) => route.summary.targetApp?.securityInspection?.passed === true),
  nativeAddonProvenancePassed: routes.every((route) => route.summary.portableBundle?.nativeAddonProvenanceValidated === true),
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
console.log(`node-production-restore: ${summary.state} ${summary.completedRoutes}/${summary.routeCount} routes; security=${summary.securityInspectionPassed}; nativeAddon=${summary.nativeAddonProvenancePassed}`);
NODE
fi
