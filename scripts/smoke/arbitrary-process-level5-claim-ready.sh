#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${TMPDIR:-/tmp}/machinen-arbitrary-process-claim-ready.$(openssl rand -hex 3)"

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-level5-claim-ready.ts --out "$WORK" --json >"$WORK.json"
node -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (report.currentArbitraryProcessCrossArchRestoreClaimed !== 0 || report.claimChangeAllowed !== true || report.verifiedSeedCount !== 3) process.exit(1);' "$WORK.json"

echo "arbitrary process claim-ready gate smoke passed: $WORK"
