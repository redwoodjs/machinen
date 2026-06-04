#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-whole-vm-corpus-product.XXXXXX")}" 

pnpm exec tsx proofs/linux-vm-workload/scripts/whole-vm-workload-corpus-product-gate.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "whole-vm-supported-corpus-product-artifacts-v1") throw new Error("whole VM corpus product gate failed"); if (s.summary.supportedCorpusRowsRequired !== 4 || s.summary.productGateRowsVerified !== 4 || s.summary.productGateDirectionsVerified !== 8 || s.summary.corpusProductSupportRowsAdded !== 4) throw new Error("product row coverage drifted"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.arbitraryVmRestoreClaimed !== false || s.summary.arbitraryVmRestoreRowsAdded !== 0 || s.summary.publicClaimRowsAdded !== 0) throw new Error("whole VM public claim drifted"); for (const row of s.rowResults) if (row.disposition !== "product-supported" || row.productSupportClaimAllowed !== false || row.arbitraryVmRestoreClaimed !== false || row.acceptedDirections.length !== 2) throw new Error(`row ${row.id} product gate drifted`);' "$WORK/summary.json"

echo "whole VM corpus product gate smoke passed: $WORK"
