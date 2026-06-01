#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${TMPDIR:-/tmp}/machinen-arbitrary-process-idle-resource.$(openssl rand -hex 3)"

pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-level5-idle-resource-proof.ts --out "$WORK" --json >"$WORK.json"
node -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!report.accepted || report.rowId !== "native-idle-epoll-or-tcp" || report.claimChangeAllowed !== false) process.exit(1);' "$WORK.json"

echo "arbitrary process idle epoll/TCP proof smoke passed: $WORK"
