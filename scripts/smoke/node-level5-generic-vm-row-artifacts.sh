#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-row-artifacts.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx proofs/nodejs/scripts/node-level5-generic-vm-corpus.ts --out "$WORK" --json >"$WORK/generic-vm-summary.json"
REPORT="$WORK/node-level5-generic-vm-corpus-report.json"
pnpm exec tsx proofs/nodejs/scripts/node-level5-generic-vm-row-artifacts.ts --generic-vm-corpus-report "$REPORT" --out "$WORK" --json >"$WORK/row-artifacts-summary.json"
ROW_REPORT="$WORK/node-level5-generic-vm-row-artifacts-report.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 release-gate --include-generic-vm-row-artifacts --generic-vm-row-artifacts-report "$ROW_REPORT" --json >"$WORK/release-gate.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.genericVmRowArtifacts?.accepted !== true || s.genericVmRowArtifacts?.rowArtifactFileCount !== 28) throw new Error("generic VM row artifacts release gate failed");' "$WORK/release-gate.json"

echo "node level5 generic VM row artifacts smoke passed: $WORK"
