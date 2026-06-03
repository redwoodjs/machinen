#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-refusal-detectors.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-refusal-detector-transcripts.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "arbitrary-process-refusal-detector-transcripts-v1") throw new Error("detector transcripts failed"); if (s.summary.refusedRowsRequired !== 14 || s.summary.detectorTranscriptsVerified !== 14 || s.summary.stableRefusalCodesVerified !== 14) throw new Error("detector row coverage drifted"); if (s.productSupportOutOfScope !== true || s.publicClaimAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.summary.productSupportRowsAdded !== 0) throw new Error("detector claim drifted"); for (const row of s.rows) if (!String(row.artifact).endsWith("-detector-transcript.json") || !row.stableRefusalCode) throw new Error(`row ${row.id} detector drifted`);' "$WORK/summary.json"

echo "arbitrary refusal detector transcript smoke passed: $WORK"
