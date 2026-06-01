#!/usr/bin/env bash
set -euo pipefail

WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-process-regular-file-fd.XXXXXX")}"
mkdir -p "$WORK"

pnpm exec tsx scripts/arbitrary-process-level5-regular-file-fd-proof.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.rowId !== "native-regular-file-fd" || s.proofStatus !== "verified-seed") throw new Error("regular file fd proof failed"); if (s.currentArbitraryProcessCrossArchRestoreClaimed !== 0 || s.claimChangeAllowed !== false || s.arbitraryProcessClaimed !== false) throw new Error("arbitrary process claim boundary drifted"); if (s.targetReconstruction.rawCpuRestoreUsed !== false || s.targetReconstruction.sourceIsaEmulationUsed !== false) throw new Error("forbidden restore mechanism used");' "$WORK/summary.json"

echo "arbitrary process regular file FD proof smoke passed: $WORK"
