#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-checkpoint-composition.XXXXXX")}"
JSON=0
KEEP=0
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --keep) KEEP=1; shift ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/portable-snapshot-guest-checkpoint-composition.sh [--json] [--keep] [--work-dir path]" >&2; exit 2 ;;
  esac
done

keep_arg=()
if [[ $KEEP -eq 1 ]]; then
  keep_arg=(--keep-work-dir)
fi

pnpm exec tsx "$ROOT/scripts/portable-snapshot-guest-checkpoint-composition.ts" \
  --work-dir "$WORK/run" \
  --summary "$WORK/summary.json" \
  --json \
  ${keep_arg+"${keep_arg[@]}"} >"$WORK/stdout.json"

node --input-type=module - "$WORK/summary.json" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!summary.pass) throw new Error(`composition smoke failed: ${summary.failures.join('; ')}`);
const row = summary.rows[0];
if (row.state !== 'completed' || row.migrationCompleted !== true) throw new Error('composition did not complete');
if (row.machinenStateModel !== 'same-arch-vmstate') throw new Error(`unexpected state model ${row.machinenStateModel}`);
if (!row.storedCheckpointImageReadableAfterRestore) throw new Error('stored checkpoint image was not readable after restore');
if (row.sourceArch !== row.targetArch) throw new Error('same-arch vmstate proof unexpectedly changed ISA');
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); const r=s.rows[0]; console.log('portable-snapshot-guest-checkpoint-composition: '+s.state+' '+r.sourceArch+'->'+r.targetArch+' model='+r.machinenStateModel+' work=$WORK')"
fi
