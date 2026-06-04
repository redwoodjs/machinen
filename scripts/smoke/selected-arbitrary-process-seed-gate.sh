#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-selected-arbitrary-process-seed.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/selected-arbitrary-process-seed-gate.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "selected-arbitrary-linux-process-seed-v1") throw new Error("selected seed gate failed"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0) throw new Error("public arbitrary-process claim changed"); if (s.productPathArtifactsRequired !== false || s.productPathArtifactsCovered !== 0 || s.productSupportRowsAdded !== 0) throw new Error("product-path artifact boundary drifted"); if (s.selectedSeedRows.length !== 3 || s.refusalRows.length !== 6) throw new Error("selected seed/refusal coverage drifted");' "$WORK/summary.json"

echo "selected arbitrary-process seed gate smoke passed: $WORK"
