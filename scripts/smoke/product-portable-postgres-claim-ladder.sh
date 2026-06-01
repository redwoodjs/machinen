#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${TMPDIR:-/tmp}/machinen-postgres-claim-ladder.$(openssl rand -hex 3)"

pnpm exec tsx proofs/postgres/scripts/product-portable-postgres-claim-ladder.ts --out "$WORK" --json >"$WORK.json"
node -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!report.accepted || report.currentClaim.productSupport !== 20 || report.currentClaim.broadSupport !== 0 || report.currentClaim.arbitraryProcessCrossArchRestore !== 0) process.exit(1);' "$WORK.json"

echo "Postgres claim ladder smoke passed: $WORK"
