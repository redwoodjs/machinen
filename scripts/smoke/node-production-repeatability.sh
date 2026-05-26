#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ITERATIONS=${PORTABLE_NODE_PRODUCTION_REPEAT_ITERATIONS:-3}
WORK=${PORTABLE_NODE_PRODUCTION_REPEAT_WORK_DIR:-}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/node-production-repeatability.sh [--json] [--keep] [--work-dir path]" >&2; exit 2; }
while (($# > 0)); do
  case "$1" in
    --) shift ;;
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) shift; [[ $# -gt 0 && ! "$1" =~ ^-- ]] || usage; WORK=$1; shift ;;
    *) usage ;;
  esac
done
if [[ -z "$WORK" ]]; then WORK=$(mktemp -d); else rm -rf "$WORK"; mkdir -p "$WORK"; fi
cleanup() { if [[ $KEEP -eq 0 ]]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT
passes=0
for i in $(seq 1 "$ITERATIONS"); do
  start=$(node -e 'process.stdout.write(String(Date.now()))')
  iter_dir="$WORK/iteration-$i"
  if PORTABLE_NODE_PRODUCTION_VERSIONS=24 bash "$ROOT/scripts/smoke/node-production-restore.sh" --keep --work-dir "$iter_dir" >"$WORK/iteration-$i.log" 2>&1; then
    status=passed
    passes=$((passes + 1))
  else
    status=failed
  fi
  end=$(node -e 'process.stdout.write(String(Date.now()))')
  node --input-type=module - "$WORK/iteration-$i.json" "$i" "$status" "$((end - start))" "$iter_dir" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const [out, iteration, status, ms, dir] = process.argv.slice(2);
const summary = existsSync(`${dir}/summary.json`) ? JSON.parse(readFileSync(`${dir}/summary.json`, 'utf8')) : null;
writeFileSync(out, `${JSON.stringify({ iteration: Number(iteration), status, ms: Number(ms), dir, summary }, null, 2)}\n`);
NODE
  [[ "$status" == passed ]] || break
done
node --input-type=module - "$WORK" "$ITERATIONS" "$passes" <<'NODE'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const [work, iterations, passes] = process.argv.slice(2);
const results = readdirSync(work).filter((name) => name.match(/^iteration-\d+\.json$/)).sort().map((name) => JSON.parse(readFileSync(`${work}/${name}`, 'utf8')));
const summary = { kind: 'machinen.production-node-repeatability', state: Number(passes) === Number(iterations) ? 'completed' : 'failed', iterations: Number(iterations), passes: Number(passes), passRate: Number(passes) / Number(iterations), results };
writeFileSync(`${work}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
process.exit(summary.state === 'completed' ? 0 : 1);
NODE
if [[ $JSON -eq 1 ]]; then cat "$WORK/summary.json"; else node -e "const s=require('$WORK/summary.json'); console.log('node-production-repeatability: '+s.state+' '+s.passes+'/'+s.iterations)"; fi
