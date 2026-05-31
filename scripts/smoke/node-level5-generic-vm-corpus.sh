#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-generic-vm-corpus.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx scripts/node-level5-generic-vm-corpus.ts --out "$WORK" --json >"$WORK/summary.json"
REPORT="$WORK/node-level5-generic-vm-corpus-report.json"
test -f "$REPORT"
pnpm exec tsx packages/cli/src/cli.ts node-level5 release-gate --include-generic-vm-corpus --generic-vm-corpus-report "$REPORT" --json >"$WORK/release-gate.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.genericVmCorpus?.positiveRowCount !== 8 || s.genericVmCorpus?.refusalRowCount !== 20) throw new Error("generic VM corpus release gate failed");' "$WORK/release-gate.json"

echo "node level5 generic VM corpus smoke passed: $WORK"
