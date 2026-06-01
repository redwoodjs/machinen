#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-85-readiness.XXXXXX")}"
cd "$ROOT"

pnpm exec tsx proofs/nodejs/scripts/node-level5-generic-vm-corpus.ts --out "$WORK" --json >"$WORK/generic-vm-summary.json"
REPORT="$WORK/node-level5-generic-vm-corpus-report.json"
mkdir -p "$WORK/snap"
printf '{"snap_dir":"%s/snap"}\n' "$WORK" >"$WORK/snapshot.json"
printf 'restored as node-level5-detected-restored\n' >"$WORK/restore.log"
printf '{"runtime":"node","subset":"node-http-clean-root-v1"}\n' >"$WORK/snap/portable-node.json"
printf 'app\n' >"$WORK/snap/portable-node-app.tar.gz"
printf '{}\n' >"$WORK/snap/portable-clean-service.json"
printf 'clean-service\n' >"$WORK/snap/clean-service-node-primary.tar.gz"
pnpm exec tsx proofs/nodejs/scripts/node-level5-generic-vm-retained-evidence.ts --work-dir "$WORK" --json >"$WORK/retained-evidence-summary.json"
RETAINED="$WORK/node-level5-generic-vm-retained-evidence-report.json"
pnpm exec tsx proofs/nodejs/scripts/node-level5-generic-vm-row-artifacts.ts --generic-vm-corpus-report "$REPORT" --out "$WORK" --json >"$WORK/row-artifacts-summary.json"
ROW_ARTIFACTS="$WORK/node-level5-generic-vm-row-artifacts-report.json"
pnpm exec tsx proofs/nodejs/scripts/node-level5-generic-vm-refusal-artifacts.ts --generic-vm-corpus-report "$REPORT" --out "$WORK" --json >"$WORK/refusal-artifacts-summary.json"
REFUSAL_ARTIFACTS="$WORK/node-level5-generic-vm-refusal-artifacts-report.json"
set +e
pnpm exec tsx packages/cli/src/cli.ts node-level5 85-readiness --generic-vm-corpus-report "$REPORT" --generic-vm-retained-evidence-report "$RETAINED" --generic-vm-row-artifacts-report "$ROW_ARTIFACTS" --generic-vm-refusal-artifacts-report "$REFUSAL_ARTIFACTS" --json >"$WORK/readiness.json"
STATUS=$?
set -e
if [[ "$STATUS" -ne 1 ]]; then
  echo "expected 85-readiness to stay locked, got status $STATUS" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== false || s.candidateEvidenceAccepted !== true || s.claimChangeAllowed !== false) throw new Error("85 readiness did not keep claim shift locked with accepted candidate evidence"); const blocked=s.blockedGates.map((g)=>g.id); if (blocked.length !== 1 || blocked[0] !== "claim-change-unlocked") throw new Error(`unexpected blocked gates: ${blocked.join(",")}`);' "$WORK/readiness.json"

echo "node level5 85 readiness smoke passed: $WORK"
