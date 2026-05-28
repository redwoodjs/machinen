#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-stateful-db.XXXXXX")}"
JSON=0
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/stateful-database-portable-restore.sh [--json] [--work-dir path]" >&2; exit 2 ;;
  esac
done

pnpm exec tsx "$ROOT/scripts/stateful-database-portable-restore.ts" \
  --summary "$WORK/summary.json" \
  --json >"$WORK/stdout.json"

node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!s.pass) throw new Error(`stateful database smoke failed: ${s.failures.join("; ")}`); if (s.completedRows !== 4 || s.refusedRows !== 12) throw new Error("unexpected row counts");' "$WORK/summary.json"

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('stateful-database-portable-restore: '+s.state+' completed='+s.completedRows+' refused='+s.refusedRows+' work=$WORK')"
fi
