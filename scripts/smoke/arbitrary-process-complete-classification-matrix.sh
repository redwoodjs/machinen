#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-process-classification.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-complete-classification-matrix.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.version !== 2 || s.scope !== "declared-arbitrary-process-state-classification-v1") throw new Error("classification proof matrix failed"); if (s.summary.requiredRows !== 20 || s.summary.verifiedRows !== 20 || s.summary.supportedProofRows !== 6 || s.summary.refusedRows !== 14 || s.summary.unknownRows !== 0) throw new Error("row coverage drifted"); if (s.summary.rowProofArtifacts !== 20 || s.summary.targetVerifierProofs !== 6 || s.summary.stableRefusalProofs !== 14 || s.summary.executableFixtureProofs !== 6 || s.proofClaim.rowProofArtifactsRetained !== 20 || s.proofClaim.executableFixtureProofs !== 6) throw new Error("proof artifact coverage drifted"); if (s.classificationClaim.declaredStateClassesClassified !== 100 || s.classificationClaim.arbitraryProcessRestoreClaimed !== 0) throw new Error("classification claim drifted"); if (s.productSupportOutOfScope !== true || s.publicClaimAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.summary.productSupportRowsAdded !== 0) throw new Error("public claim drifted"); for (const row of s.rows) { if (row.productSupportClaimAllowed !== false || row.arbitraryRestoreClaimAllowed !== false) throw new Error(`row ${row.id} overclaimed`); if (!String(row.proofArtifact).endsWith("-proof.json") || row.proofChecksPassed < 4 || !row.proofArtifactSha256) throw new Error(`row ${row.id} missing retained proof`); if (row.disposition === "supported-proof" && (row.proofQuality !== "executable-fixture-proof" || !row.executableFixture)) throw new Error(`row ${row.id} missing executable fixture proof`); }' "$WORK/summary.json"

echo "arbitrary process complete proof matrix smoke passed: $WORK"
