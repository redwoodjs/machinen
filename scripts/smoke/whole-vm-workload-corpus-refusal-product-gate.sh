#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-whole-vm-corpus-refusal.XXXXXX")}" 

pnpm exec tsx proofs/linux-vm-workload/scripts/whole-vm-workload-corpus-refusal-product-gate.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "whole-vm-refused-corpus-product-refusals-v1") throw new Error("whole VM corpus refusal product gate failed"); if (s.summary.refusedCorpusRowsRequired !== 4 || s.summary.productRefusalRowsVerified !== 4 || s.summary.productRefusalDirectionsVerified !== 8) throw new Error("refusal row coverage drifted"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.arbitraryVmRestoreClaimed !== false || s.summary.arbitraryVmRestoreRowsAdded !== 0 || s.summary.publicClaimRowsAdded !== 0) throw new Error("whole VM refusal public claim drifted"); for (const row of s.rowResults) if (!String(row.artifact).endsWith("-product-refusal.json") || row.arbitraryVmRestoreClaimed !== false || row.acceptedDirections.length !== 2) throw new Error(`row ${row.id} refusal gate drifted`);' "$WORK/summary.json"

echo "whole VM corpus refusal product gate smoke passed: $WORK"
