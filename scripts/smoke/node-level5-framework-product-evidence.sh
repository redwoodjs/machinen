#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-framework-product-evidence.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx proofs/nodejs/scripts/node-level5-framework-product-evidence.ts --out "$WORK" --json >"$WORK/summary.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.graphArtifactCount !== 18 || s.restoredBehaviorProbeCount !== 16 || s.refusalArtifactCount !== 20) throw new Error("framework product evidence failed");' "$WORK/summary.json"

echo "node level5 framework product evidence smoke passed: $WORK"
