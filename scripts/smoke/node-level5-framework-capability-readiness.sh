#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-framework-readiness.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx proofs/nodejs/scripts/node-level5-framework-introspection-corpus.ts --out "$WORK" --json >"$WORK/summary.json"
REPORT="$WORK/node-level5-framework-introspection-corpus-report.json"
set +e
pnpm exec tsx packages/cli/src/cli.ts node-level5 framework-readiness --framework-introspection-corpus-report "$REPORT" --json >"$WORK/readiness.json"
STATUS=$?
set -e
if [[ "$STATUS" -ne 1 ]]; then
  echo "expected framework readiness to stay locked, got status $STATUS" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== false || s.candidateEvidenceAccepted !== true || s.claimChangeAllowed !== false) throw new Error("framework readiness did not keep claim locked"); if (s.coverage?.expectedRows !== 16 || s.coverage?.missingCoverageKeys?.length !== 0) throw new Error("framework readiness coverage failed"); if (s.currentBroadNodeProductSupportClaimed !== 25 || s.candidateBroadNodeProductSupportClaimed !== 30) throw new Error("framework readiness claims drifted");' "$WORK/readiness.json"

echo "node level5 framework capability readiness smoke passed: $WORK"
