#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-whole-vm-db-tooling.XXXXXX")}" 

pnpm exec tsx proofs/linux-vm-workload/scripts/whole-vm-db-tooling-support-path.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "whole-vm-clean-db-tooling-support-path-v1") throw new Error("DB tooling support path failed"); if (s.summary.cleanDbRowsRequired !== 2 || s.summary.cleanDbProductGateRowsVerified !== 2 || s.summary.cleanDbDirectionsVerified !== 4 || s.summary.dirtyActiveDbRefusalsVerified !== 2) throw new Error("DB tooling coverage drifted"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.arbitraryVmRestoreClaimed !== false || s.summary.arbitraryVmRestoreRowsAdded !== 0 || s.summary.publicClaimRowsAdded !== 0) throw new Error("DB tooling public claim drifted"); for (const row of s.rowResults) if (!String(row.artifact).endsWith("-tooling-product-gate.json") || row.acceptedDirections.length !== 2) throw new Error(`row ${row.id} DB tooling drifted`);' "$WORK/summary.json"

echo "whole VM DB tooling support path smoke passed: $WORK"
