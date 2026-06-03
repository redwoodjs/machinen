#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-whole-vm-decision.XXXXXX")}" 

pnpm exec tsx proofs/linux-vm-workload/scripts/whole-vm-workload-claim-scope-decision-card.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.recommendation !== "keep-current-public-claim-scope") throw new Error("decision card failed"); if (s.publicClaimChangeAllowed !== false || s.currentClaimScope !== "selected-whole-vm-workload-v1 only") throw new Error("decision card claim drifted"); if (s.productGatedRows.length !== 4 || s.productRefusedRows.length !== 4) throw new Error("decision card row coverage drifted"); if (s.noShortcutPolicy.arbitraryVmRestoreAccepted !== false || s.noShortcutPolicy.sourceIsaEmulationAccepted !== false) throw new Error("decision card shortcut drifted");' "$WORK/summary.json"

echo "whole VM claim scope decision card smoke passed: $WORK"
