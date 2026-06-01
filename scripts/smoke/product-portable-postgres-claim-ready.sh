#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${TMPDIR:-/tmp}/machinen-postgres-claim-ready.$(openssl rand -hex 3)"

pnpm exec tsx proofs/postgres/scripts/product-portable-postgres-claim-ready.ts --out "$WORK" --json >"$WORK.json"
node -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!report.accepted || report.gate !== "postgres-clean-logical-20-claim-ready" || report.currentClaim.productSupport !== 20 || report.candidateClaim.productSupport !== 40 || report.claimChangeAllowed !== true || report.publicClaimRaised !== false || report.rows.length !== 18) process.exit(1);' "$WORK.json"

echo "Postgres clean logical 20 claim-ready smoke passed: $WORK"
