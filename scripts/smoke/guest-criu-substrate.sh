#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-guest-criu.XXXXXX")}"
JSON=0
PROFILE=all
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/guest-criu-substrate.sh [--json] [--profile all|c-simple|jvm-simple] [--work-dir path]" >&2; exit 2 ;;
  esac
done

pnpm exec tsx "$ROOT/scripts/guest-criu-substrate.ts" \
  --profile "$PROFILE" \
  --summary "$WORK/summary.json" \
  --json >"$WORK/stdout.json"

node --input-type=module - "$WORK/summary.json" "$PROFILE" <<'NODE'
import { readFileSync } from 'node:fs';
const [summaryPath, profile] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
if (!summary.pass) throw new Error(`guest CRIU substrate failed: ${summary.failures.join('; ')}`);
const c = summary.rows.find((row) => row.profile === 'c-simple');
const jvm = summary.rows.find((row) => row.profile === 'jvm-simple');
if ((profile === 'all' || profile === 'c-simple') && (!c || c.state !== 'completed')) {
  throw new Error('C CRIU profile did not complete');
}
if ((profile === 'all' || profile === 'jvm-simple') && (!jvm || !['completed', 'refused'].includes(jvm.state))) {
  throw new Error('JVM CRIU profile did not complete or refuse');
}
if (jvm?.state === 'refused' && (!jvm.refusalCode || !jvm.remediation)) {
  throw new Error('JVM refusal missing stable code/remediation');
}
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('guest-criu-substrate: '+s.state+' completed='+s.completedRows+' refused='+s.refusedRows+' profile=$PROFILE work=$WORK')"
fi
