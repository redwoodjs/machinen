#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-arbitrary-process-level5-seed.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx scripts/arbitrary-process-level5-seed-matrix.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.rowCount !== 14 || s.artifactCount !== 14) throw new Error("seed matrix failed"); if (s.currentArbitraryProcessCrossArchRestoreClaimed !== 0 || s.candidateArbitraryProcessCrossArchRestoreClaimed !== 1 || s.claimChangeAllowed !== false || s.arbitraryProcessClaimed !== false) throw new Error("arbitrary process claim boundary drifted");' "$WORK/summary.json"

echo "arbitrary process level5 seed matrix smoke passed: $WORK"
