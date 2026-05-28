#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-controlled-continuation.XXXXXX")}"
JSON=0
LIVE=0
TARGET_SSH=${ARCH_PORTABLE_AMD64_SSH:-${PORTABLE_AMD64_SSH:-root@192.168.0.8}}
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift ;;
    --json) JSON=1; shift ;;
    --live) LIVE=1; shift ;;
    --target-ssh) TARGET_SSH="$2"; shift 2 ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/architecture-portable-controlled-continuation.sh [--json] [--live] [--target-ssh host] [--work-dir path]" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
args=(--summary "$WORK/summary.json" --work-dir "$WORK/run" --keep --json)
if [[ $LIVE -eq 1 ]]; then
  args+=(--live --target-ssh "$TARGET_SSH")
fi
pnpm run architecture-portable-controlled-continuation "${args[@]}" >"$WORK/stdout.json"

pnpm run architecture-portable-controlled-continuation --negative sidecar-output --summary "$WORK/sidecar-negative.json" --work-dir "$WORK/negative-sidecar" --json >"$WORK/sidecar-negative.stdout"
pnpm run architecture-portable-controlled-continuation --negative metadata-only --summary "$WORK/metadata-negative.json" --work-dir "$WORK/negative-metadata" --json >"$WORK/metadata-negative.stdout"

node --input-type=module - "$WORK/summary.json" "$WORK/sidecar-negative.json" "$WORK/metadata-negative.json" "$LIVE" <<'NODE'
import { readFileSync } from 'node:fs';
const [summaryPath, sidecarPath, metadataPath, liveFlag] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
if (!summary.pass) throw new Error(`controlled continuation summary failed: ${summary.failures.join('; ')}`);
if (summary.rowCount !== 1) throw new Error(`expected one row, saw ${summary.rowCount}`);
const row = summary.rows[0];
if (row.claimId !== 'controlled-c-translated-continuation') throw new Error('wrong claim id');
if (row.sourceArch === row.targetArch) throw new Error('source and target arch must differ');
if (row.classification !== 'proof-only-feasibility') throw new Error(`unexpected classification ${row.classification}`);
if (liveFlag === '1') {
  if (!row.migrationCompleted) throw new Error('live mode did not complete migration');
  if (row.targetExecution !== 'native') throw new Error('live mode was not target-native');
  if (!row.verifierOutput.includes('target-native-continuation-ok')) throw new Error('missing target verifier marker');
} else if (row.migrationCompleted) {
  throw new Error('fixture mode must not set migrationCompleted=true');
}
const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')).rows[0];
if (sidecar.classification !== 'refused' || sidecar.refusalCode !== 'sidecar-output-refused' || sidecar.migrationCompleted) throw new Error('sidecar negative was not refused');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')).rows[0];
if (metadata.classification !== 'refused' || metadata.refusalCode !== 'metadata-only-continuation-refused' || metadata.migrationCompleted) throw new Error('metadata negative was not refused');
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require(process.argv[1]); const r=s.rows[0]; console.log('architecture-portable-controlled-continuation: '+s.state+' '+r.sourceArch+'->'+r.targetArch+' migrationCompleted='+r.migrationCompleted+' work=$WORK')" "$WORK/summary.json"
fi
