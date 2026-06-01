#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-90-claim.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx proofs/nodejs/scripts/node-level5-framework-introspection-corpus.ts --out "$WORK" --json >"$WORK/introspection-summary.json"
INTROSPECTION_REPORT="$WORK/node-level5-framework-introspection-corpus-report.json"
set +e
pnpm exec tsx packages/cli/src/cli.ts node-level5 framework-readiness --framework-introspection-corpus-report "$INTROSPECTION_REPORT" --json >"$WORK/framework-readiness.json"
READINESS_STATUS=$?
set -e
if [[ "$READINESS_STATUS" -ne 1 ]]; then
  echo "expected framework readiness pre-claim report to stay locked, got $READINESS_STATUS" >&2
  exit 1
fi

pnpm exec tsx proofs/nodejs/scripts/node-level5-framework-product-evidence.ts --out "$WORK" --json >"$WORK/product-evidence-summary.json"
PRODUCT_EVIDENCE_REPORT="$WORK/node-level5-framework-product-evidence-report.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 framework-claim-ready --readiness-report "$WORK/framework-readiness.json" --framework-product-evidence-report "$PRODUCT_EVIDENCE_REPORT" --json >"$WORK/framework-claim-ready.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 claims --json >"$WORK/claims.json"

node -e 'const fs=require("fs"); const claimReady=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const claims=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); if (claimReady.accepted !== true || claimReady.candidateNodeProductSupportClaimed !== 90 || claimReady.candidateBroadNodeProductSupportClaimed !== 30) throw new Error("framework claim-ready did not prove 90 / 30 / 0"); const registry=claims.claimRegistry; if (registry.nodeProductSupportClaimed !== 90 || registry.broadNodeProductSupportClaimed !== 30 || registry.arbitraryProcessCrossArchRestoreClaimed !== 0) throw new Error("claim registry did not report 90 / 30 / 0");' "$WORK/framework-claim-ready.json" "$WORK/claims.json"

echo "node level5 90 claim smoke passed: $WORK"
