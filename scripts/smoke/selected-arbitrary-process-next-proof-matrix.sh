#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-selected-arbitrary-process-next.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/selected-arbitrary-process-next-proof-matrix.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "selected-arbitrary-linux-process-seed-v1") throw new Error("next proof matrix failed"); if (s.summary.requiredRows !== 10 || s.summary.verifiedRows !== 10) throw new Error("row count drifted"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.summary.productSupportRowsAdded !== 0) throw new Error("claim drifted"); const ids=s.rows.map((row)=>row.proofNumber).join(","); for (const id of ["arbitrary/009","arbitrary/010","arbitrary/011","arbitrary/012","arbitrary/013","arbitrary/014","arbitrary/015","arbitrary/016","arbitrary/017","arbitrary/018"]) if (!ids.includes(id)) throw new Error(`missing ${id}`);' "$WORK/summary.json"

echo "selected arbitrary-process next proof matrix smoke passed: $WORK"
