#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-final-gauntlet.XXXXXX")}" 
JSON=0
FULL=0
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --full) FULL=1; shift ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/final-cross-arch-criu-gauntlet.sh [--json] [--full] [--work-dir path]" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
args=(--out "$WORK/final-gauntlet.json")
if [[ $FULL -eq 0 ]]; then
  args+=(--fixture)
fi
pnpm run final-cross-arch-criu-gauntlet "${args[@]}" >"$WORK/stdout.json"

node --input-type=module - "$WORK/final-gauntlet.json" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!summary.pass) throw new Error(`final gauntlet failed: ${summary.failures.join('; ')}`);
if (summary.rowCount !== 15) throw new Error(`expected 15 rows, got ${summary.rowCount}`);
if (summary.rows.some((row) => row.classification === 'product-supported')) throw new Error('fixture/final gauntlet unexpectedly claimed product support');
if (summary.rows.some((row) => ['refused', 'skipped'].includes(row.classification) && row.migrationCompleted)) throw new Error('refused/skipped row migrated');
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/final-gauntlet.json"
else
  node -e "const s=require(process.argv[1]); console.log('final-cross-arch-criu-gauntlet: '+s.state+' rows='+s.rowCount+' work=$WORK')" "$WORK/final-gauntlet.json"
fi
