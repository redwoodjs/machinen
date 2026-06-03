#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-selected-arbitrary-process-behavior.XXXXXX")}" 

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/selected-arbitrary-process-behavior-e2e.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.scope !== "selected-arbitrary-linux-process-seed-v1") throw new Error("behavior e2e failed"); if (s.behaviorChecks.length !== 5 || !s.behaviorChecks.every((row)=>row.status === "verified")) throw new Error("behavior checks drifted"); if (s.refusalRows.length !== 8 || !s.refusalRows.every((row)=>row.status === "refused")) throw new Error("refusal rows drifted"); if (s.publicClaimAllowed !== false || s.claimChangeAllowed !== false || s.currentClaim.arbitraryProcessCrossArchRestore !== 0 || s.productSupportRowsAdded !== 0) throw new Error("claim drifted"); if (s.targetVerifier.argvMatched !== true || s.targetVerifier.staticDataHeapMatched !== true || s.targetVerifier.regularFileFdVerified !== true || s.targetVerifier.simplePipeFdVerified !== true || s.targetVerifier.idleEpollTcpVerified !== true) throw new Error("target verifier drifted");' "$WORK/summary.json"

echo "selected arbitrary-process behavior e2e smoke passed: $WORK"
