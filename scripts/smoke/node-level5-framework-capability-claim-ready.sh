#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-framework-claim-ready.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx proofs/nodejs/scripts/node-level5-framework-introspection-corpus.ts --out "$WORK" --json >"$WORK/introspection-summary.json"
INTROSPECTION_REPORT="$WORK/node-level5-framework-introspection-corpus-report.json"
set +e
pnpm exec tsx packages/cli/src/cli.ts node-level5 framework-readiness --framework-introspection-corpus-report "$INTROSPECTION_REPORT" --json >"$WORK/readiness.json"
READINESS_STATUS=$?
set -e
if [[ "$READINESS_STATUS" -ne 1 ]]; then
  echo "expected framework readiness to stay locked, got status $READINESS_STATUS" >&2
  exit 1
fi
pnpm exec tsx proofs/nodejs/scripts/node-level5-framework-product-evidence.ts --out "$WORK" --json >"$WORK/product-evidence-summary.json"
PRODUCT_EVIDENCE_REPORT="$WORK/node-level5-framework-product-evidence-report.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 framework-claim-ready --readiness-report "$WORK/readiness.json" --framework-product-evidence-report "$PRODUCT_EVIDENCE_REPORT" --json >"$WORK/claim-ready.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.claimReadyEvidenceAccepted !== true || s.claimChangeAllowed !== true) throw new Error("framework claim-ready gate failed"); if (s.candidateNodeProductSupportClaimed !== 90 || s.candidateBroadNodeProductSupportClaimed !== 30 || s.candidateArbitraryProcessCrossArchRestoreClaimed !== 0) throw new Error("framework claim-ready target drifted");' "$WORK/claim-ready.json"

echo "node level5 framework capability claim-ready smoke passed: $WORK"
