#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-process-100-ladder.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-100-phase-ladder.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.summary.phaseRows !== 7) throw new Error("phase ladder failed"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0) throw new Error("public claim drifted"); if (s.summary.productSupportRowsAdded !== 0 || s.summary.publicArbitraryProcessClaim !== 0) throw new Error("product support drifted"); for (const phase of s.phases) if (phase.claimChangeAllowed !== false || phase.productPathCovered !== false) throw new Error(`phase ${phase.id} overclaimed`);' "$WORK/summary.json"

echo "arbitrary process 100 phase ladder smoke passed: $WORK"
