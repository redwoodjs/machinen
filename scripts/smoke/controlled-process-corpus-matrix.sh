#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-controlled-process-corpus.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/controlled-process-corpus-matrix.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.proofNumber !== "arbitrary/019") throw new Error("controlled process corpus failed"); if (s.summary.requiredRows !== 10 || s.summary.verifiedRows !== 10 || s.summary.supportedProofRows !== 6 || s.summary.refusedRows !== 4 || s.summary.unknownRows !== 0) throw new Error("row coverage drifted"); if (s.productSupportOutOfScope !== true || s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.summary.productSupportRowsAdded !== 0) throw new Error("claim drifted"); if (!s.rows.every((row)=>row.proofOnly === true && row.productPathRequired === false && row.productSupportClaimAllowed === false)) throw new Error("product path boundary drifted");' "$WORK/summary.json"

echo "controlled process corpus matrix smoke passed: $WORK"
