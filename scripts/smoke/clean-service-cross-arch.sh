#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-clean-service-cross-arch.XXXXXX")}"
JSON=0
KEEP=0
RUNTIMES=${CLEAN_SERVICE_CROSS_ARCH_RUNTIMES:-node,python}

usage() {
  echo "usage: bash scripts/smoke/clean-service-cross-arch.sh [--json] [--keep] [--work-dir path] [--runtime node|python|all]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) WORK="$2"; shift 2 ;;
    --runtime)
      case "$2" in
        node) RUNTIMES=node ;;
        python) RUNTIMES=python ;;
        all) RUNTIMES=node,python ;;
        *) usage ;;
      esac
      shift 2
      ;;
    *) usage ;;
  esac
done

mkdir -p "$WORK/routes"

if [[ $KEEP -eq 0 ]]; then
  trap 'rm -rf "$WORK/tmp"' EXIT
fi

runtime_script() {
  case "$1" in
    node) echo "$ROOT/scripts/smoke/node-product-snapshot-restore.sh" ;;
    python) echo "$ROOT/scripts/smoke/clean-service-python-product-snapshot-restore.sh" ;;
    *) echo "unsupported runtime $1" >&2; exit 2 ;;
  esac
}

run_route() {
  local runtime=$1 source_arch=$2 target_arch=$3
  local route="${runtime}-${source_arch}-to-${target_arch}"
  local route_dir="$WORK/routes/$route"
  mkdir -p "$route_dir"
  local start end status
  start=$(node -e 'process.stdout.write(String(Date.now()))')
  if MACHINEN_GUEST_ARCH="$source_arch" WORK_DIR="$route_dir" bash "$(runtime_script "$runtime")" >"$route_dir/stdout.log" 2>"$route_dir/stderr.log"; then
    status=completed
  else
    status=failed
  fi
  end=$(node -e 'process.stdout.write(String(Date.now()))')
  node --input-type=module - "$route_dir/summary.json" "$runtime" "$source_arch" "$target_arch" "$status" "$((end - start))" <<'NODE'
import { writeFileSync } from 'node:fs';
const [out, runtime, sourceArch, targetArch, state, elapsedMs] = process.argv.slice(2);
writeFileSync(out, JSON.stringify({ runtime, sourceArch, targetArch, state, elapsedMs: Number(elapsedMs) }, null, 2) + '\n');
NODE
  [[ "$status" = completed ]]
}

failures=0
IFS=',' read -r -a runtime_array <<<"$RUNTIMES"
for runtime in "${runtime_array[@]}"; do
  run_route "$runtime" arm64 amd64 || failures=$((failures + 1))
  run_route "$runtime" amd64 arm64 || failures=$((failures + 1))
done

node --input-type=module - "$WORK" "$failures" <<'NODE'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const [work, failuresRaw] = process.argv.slice(2);
const routes = readdirSync(`${work}/routes`).sort().map((route) => JSON.parse(readFileSync(`${work}/routes/${route}/summary.json`, 'utf8')));
const summary = {
  kind: 'machinen.clean-service-cross-arch-smoke',
  state: Number(failuresRaw) === 0 ? 'completed' : 'failed',
  matrix: 'Node/Python x arm64→amd64 x amd64→arm64',
  routeCount: routes.length,
  completedRoutes: routes.filter((route) => route.state === 'completed').length,
  routes,
};
writeFileSync(`${work}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('clean-service-cross-arch: '+s.state+' '+s.completedRoutes+'/'+s.routeCount+' routes')"
fi

[[ $failures -eq 0 ]]
