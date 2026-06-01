#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-100-claim.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx scripts/node-level5-node-service-claim-ladder.ts --out "$WORK" --json >"$WORK/claim-ladder-summary.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 claims --json >"$WORK/claims.json"
node -e 'const fs=require("fs"); const ladder=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const claims=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); if (ladder.accepted !== true || ladder.finalNodeProductSupportClaimed !== 100 || ladder.finalBroadNodeProductSupportClaimed !== 100) throw new Error("claim ladder did not prove 100 / 100 / 0"); const registry=claims.claimRegistry; if (registry.nodeProductSupportClaimed !== 100 || registry.broadNodeProductSupportClaimed !== 100 || registry.arbitraryProcessCrossArchRestoreClaimed !== 0) throw new Error("claim registry did not report 100 / 100 / 0"); if (registry.arbitraryNodeClaimed !== false || registry.arbitraryProcessClaimed !== false) throw new Error("arbitrary support boundary drifted");' "$WORK/claim-ladder-summary.json" "$WORK/claims.json"

echo "node level5 100 claim smoke passed: $WORK"
