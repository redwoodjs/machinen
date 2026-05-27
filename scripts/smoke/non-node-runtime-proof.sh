#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WORK=${NON_NODE_RUNTIME_WORK_DIR:-}
JSON=0
KEEP=0
usage() { echo "usage: bash scripts/smoke/non-node-runtime-proof.sh [--json] [--keep] [--work-dir path]" >&2; exit 2; }
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

for runtime in jvm python ruby go all; do
  node "$ROOT/scripts/non-node-runtime-proof.mjs" run-suite \
    --runtime "$runtime" \
    --host-label "local-non-node-runtime" \
    --out "$WORK/$runtime.json" \
    --work-dir "$WORK/work-$runtime"
done

node --input-type=module - "$WORK" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [work] = process.argv.slice(2);
const runtimes = ['jvm', 'python', 'ruby', 'go'];
const summaries = Object.fromEntries(['all', ...runtimes].map((name) => [name, JSON.parse(readFileSync(`${work}/${name}.json`, 'utf8'))]));
const output = {
  kind: 'machinen.non-node-runtime-smoke',
  state: Object.values(summaries).every((summary) => summary.state === 'completed') ? 'completed' : 'failed',
  runtimes: Object.fromEntries(runtimes.map((name) => [name, summaries.all.runtimes[name].state])),
  supportClaimed: Object.fromEntries(runtimes.map((name) => [name, summaries.all.runtimes[name].supportClaimed])),
  summaries,
  assertions: {
    jvmFailClosedOrSupported: ['supported', 'refused'].includes(summaries.all.runtimes.jvm.state),
    pythonFailClosedOrSupported: ['supported', 'refused'].includes(summaries.all.runtimes.python.state),
    rubyFailClosedOrSupported: ['supported', 'refused'].includes(summaries.all.runtimes.ruby.state),
    goFailClosedOrSupported: ['supported', 'refused'].includes(summaries.all.runtimes.go.state),
    noShortcutArtifacts: Object.values(summaries.all.runtimes).every((runtime) => runtime.securityInspection?.passed === true),
  },
};
writeFileSync(`${work}/summary.json`, `${JSON.stringify(output, null, 2)}\n`);
process.exit(output.state === 'completed' && Object.values(output.assertions).every(Boolean) ? 0 : 1);
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('non-node-runtime-proof: '+s.state+' '+JSON.stringify(s.runtimes))"
fi
