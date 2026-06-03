#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-process-classification.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-complete-classification-matrix.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "declared-arbitrary-process-state-classification-v1") throw new Error("classification matrix failed"); if (s.summary.requiredRows !== 20 || s.summary.verifiedRows !== 20 || s.summary.supportedProofRows !== 6 || s.summary.refusedRows !== 14 || s.summary.unknownRows !== 0) throw new Error("row coverage drifted"); if (s.classificationClaim.declaredStateClassesClassified !== 100 || s.classificationClaim.arbitraryProcessRestoreClaimed !== 0) throw new Error("classification claim drifted"); if (s.productSupportOutOfScope !== true || s.publicClaimAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.summary.productSupportRowsAdded !== 0) throw new Error("public claim drifted"); for (const row of s.rows) if (row.productSupportClaimAllowed !== false || row.arbitraryRestoreClaimAllowed !== false) throw new Error(`row ${row.id} overclaimed`);' "$WORK/summary.json"

echo "arbitrary process complete classification matrix smoke passed: $WORK"
