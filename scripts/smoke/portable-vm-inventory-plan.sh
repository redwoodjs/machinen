#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-inventory.XXXXXX")}" 

pnpm exec tsx proofs/linux-vm-workload/scripts/portable-vm-inventory-plan.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "controlled-portable-vm-inventory-plan-v1") throw new Error("portable VM inventory plan failed"); if (s.summary.rawInventoryItems !== 12 || s.summary.planRows !== 12 || s.summary.refusedRows !== 5 || s.summary.unknownRowsAccepted !== 0) throw new Error("portable VM inventory row coverage drifted"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.arbitraryVmRestoreClaimed !== false || s.summary.productSupportRowsAdded !== 0 || s.summary.arbitraryVmRestoreRowsAdded !== 0) throw new Error("portable VM inventory claim drifted"); for (const artifact of s.artifacts) if (!artifact.sha256 || !artifact.path.endsWith(".json")) throw new Error(`artifact ${artifact.name} drifted`);' "$WORK/summary.json"

echo "portable VM inventory plan smoke passed: $WORK"
