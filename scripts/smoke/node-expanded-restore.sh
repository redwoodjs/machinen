#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ARM64_SSH=${PORTABLE_ARM64_SSH:-friend@100.126.46.90}
AMD64_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
VERSIONS=${PORTABLE_NODE_EXPANDED_VERSIONS:-20,22,24}
WORK=${PORTABLE_NODE_EXPANDED_WORK_DIR:-}
JSON=0
KEEP=0

usage() {
  echo "usage: bash scripts/smoke/node-expanded-restore.sh [--json] [--keep] [--work-dir path]" >&2
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

log() { if [[ $JSON -eq 0 ]]; then echo "node-expanded-restore: $*"; fi; }

ssh -o BatchMode=yes -o ConnectTimeout=5 "$ARM64_SSH" true >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=5 "$AMD64_SSH" true >/dev/null
ssh "$ARM64_SSH" 'docker info >/dev/null 2>&1'
ssh "$AMD64_SSH" 'docker info >/dev/null 2>&1'

stage_script() {
  local dest=$1
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "$ROOT/scripts/node-expanded-restore-proof.mjs" "$dest/"
}

remote_node_run() {
  local host=$1 image=$2 remote_dir=$3 command=$4
  ssh "$host" "docker run --rm -v '$remote_dir':'/work' -w /work '$image' bash -lc 'if ! command -v file >/dev/null 2>&1; then apt-get update >/dev/null && apt-get install -y --no-install-recommends file gcc g++ make >/dev/null; fi; $command'"
}

IFS=, read -r -a VERSION_LIST <<<"$VERSIONS"
for version in "${VERSION_LIST[@]}"; do
  image="node:${version}-bookworm"
  source_stage="$WORK/source-amd64-node$version"
  stage_script "$source_stage"
  log "capturing expanded Node source on Proxmox amd64 with Node $version"
  tar --no-xattrs -czf - -C "$source_stage" . | ssh "$AMD64_SSH" "rm -rf /tmp/machinen-expanded-node-source-$version-$$ && mkdir -p /tmp/machinen-expanded-node-source-$version-$$ && tar -xzf - -C /tmp/machinen-expanded-node-source-$version-$$"
  remote_node_run "$AMD64_SSH" "$image" "/tmp/machinen-expanded-node-source-$version-$$" "node node-expanded-restore-proof.mjs run-suite --role source --host-label proxmox-amd64-expanded --version-label node-$version --out /work/source.json --work-dir /tmp/expanded-source-$version-$$"
  ssh "$AMD64_SSH" "cat /tmp/machinen-expanded-node-source-$version-$$/source.json" >"$WORK/source-amd64-node$version.json"

  target_stage="$WORK/target-arm64-node$version"
  stage_script "$target_stage"
  mkdir -p "$target_stage/source"
  cp "$WORK/source-amd64-node$version.json" "$target_stage/source/source.json"
  log "restoring expanded Node source from amd64 onto remote-builder arm64 with Node $version"
  tar --no-xattrs -czf - -C "$target_stage" . | ssh "$ARM64_SSH" "rm -rf /tmp/machinen-expanded-node-target-$version-$$ && mkdir -p /tmp/machinen-expanded-node-target-$version-$$ && tar -xzf - -C /tmp/machinen-expanded-node-target-$version-$$"
  remote_node_run "$ARM64_SSH" "$image" "/tmp/machinen-expanded-node-target-$version-$$" "node node-expanded-restore-proof.mjs run-suite --role target --host-label remote-builder-arm64-expanded --version-label node-$version --source-suite /work/source/source.json --out /work/target.json --work-dir /tmp/expanded-target-$version-$$"
  ssh "$ARM64_SSH" "cat /tmp/machinen-expanded-node-target-$version-$$/target.json" >"$WORK/target-arm64-node$version.json"
done

node --input-type=module - "$WORK" "$VERSIONS" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [work, versionsCsv] = process.argv.slice(2);
const routes = versionsCsv.split(',').map((version) => {
  const source = JSON.parse(readFileSync(`${work}/source-amd64-node${version}.json`, 'utf8'));
  const target = JSON.parse(readFileSync(`${work}/target-arm64-node${version}.json`, 'utf8'));
  return {
    name: `amd64-node${version}-to-arm64-node${version}`,
    version: `node-${version}`,
    state: target.state,
    sourceState: source.state,
    route: target.route,
    targetRestore: target.targetRestore,
    refusalCount: target.refusals.length,
    securityInspection: target.targetArtifacts.securityInspection,
    summary: target,
  };
});
const completedRoutes = routes.filter((route) => route.state === 'completed').length;
const output = {
  kind: 'machinen.expanded-node-restore-smoke',
  state: completedRoutes === routes.length ? 'completed' : 'failed',
  routeCount: routes.length,
  completedRoutes,
  routes,
  assertions: {
    arbitraryExistingProcesses: routes.every((route) => route.targetRestore.arbitraryExistingProcessRestoreResult === 'passed'),
    activeHttpTcpPreservation: routes.every((route) => route.targetRestore.activeTcpPreservationResult === 'passed'),
    childProcessIpcTrees: routes.every((route) => route.targetRestore.childProcessIpcResult === 'passed'),
    inspectorPolicy: routes.every((route) => route.targetRestore.inspectorPolicyResult === 'passed'),
    dirtyPersistentState: routes.every((route) => route.targetRestore.dirtyPersistentStateResult === 'passed'),
    broadNativeAddonAbi: routes.every((route) => route.targetRestore.nativeAddonAbiMatrixResult === 'passed'),
    amd64ToArm64: routes.every((route) => route.targetRestore.reverseRouteResult === 'passed'),
    noShortcutArtifacts: routes.every((route) => route.securityInspection.passed === true),
  },
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
console.log(`node-expanded-restore: ${summary.state} ${summary.completedRoutes}/${summary.routeCount} amd64->arm64 routes`);
NODE
fi
