#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-refusal-artifacts.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx scripts/node-level5-generic-vm-corpus.ts --out "$WORK" --json >"$WORK/generic-vm-summary.json"
REPORT="$WORK/node-level5-generic-vm-corpus-report.json"
pnpm exec tsx scripts/node-level5-generic-vm-refusal-artifacts.ts --generic-vm-corpus-report "$REPORT" --out "$WORK" --json >"$WORK/refusal-artifacts-summary.json"
REFUSAL_REPORT="$WORK/node-level5-generic-vm-refusal-artifacts-report.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 release-gate --include-generic-vm-refusal-artifacts --generic-vm-refusal-artifacts-report "$REFUSAL_REPORT" --json >"$WORK/release-gate.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.genericVmRefusalArtifacts?.accepted !== true || s.genericVmRefusalArtifacts?.refusalArtifactFileCount !== 20) throw new Error("generic VM refusal artifacts release gate failed");' "$WORK/release-gate.json"

echo "node level5 generic VM refusal artifacts smoke passed: $WORK"
