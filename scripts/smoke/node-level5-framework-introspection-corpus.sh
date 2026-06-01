#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-framework-introspection.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx scripts/node-level5-framework-introspection-corpus.ts --out "$WORK" --json >"$WORK/summary.json"
REPORT="$WORK/node-level5-framework-introspection-corpus-report.json"
pnpm exec tsx packages/cli/src/cli.ts node-level5 release-gate --include-framework-introspection-corpus --framework-introspection-corpus-report "$REPORT" --json >"$WORK/release-gate.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.frameworkIntrospectionCorpus?.accepted !== true || s.frameworkIntrospectionCorpus?.rowCount !== 16) throw new Error("framework introspection corpus release gate failed");' "$WORK/release-gate.json"

echo "node level5 framework introspection corpus smoke passed: $WORK"
