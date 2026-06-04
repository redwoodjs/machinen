#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-bidir-output.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-bidirectional-target-output-hardening.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "arbitrary-process-bidirectional-target-output-hardening-v1") throw new Error("bidirectional target output hardening failed"); if (s.summary.supportedRowsRequired !== 6 || s.summary.supportedRowsVerified !== 6 || s.summary.targetOutputArtifactsRetained !== 12 || s.summary.bidirectionalDirectionsVerified !== 12) throw new Error("target output coverage drifted"); if (s.productSupportOutOfScope !== true || s.publicClaimAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.summary.productSupportRowsAdded !== 0) throw new Error("target output claim drifted"); for (const row of s.rows) if (row.artifacts.length !== 2 || row.directions.length !== 2) throw new Error(`row ${row.id} target output drifted`);' "$WORK/summary.json"

echo "arbitrary bidirectional target output hardening smoke passed: $WORK"
