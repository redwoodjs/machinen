#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-85-claim-ready.XXXXXX")}"
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
READINESS_STATUS=$?
pnpm exec tsx packages/cli/src/cli.ts node-level5 85-claim-ready --readiness-report "$WORK/readiness.json" --json >"$WORK/claim-ready.json"
CLAIM_READY_STATUS=$?
set -e
if [[ "$READINESS_STATUS" -ne 1 || "$CLAIM_READY_STATUS" -ne 0 ]]; then
  echo "expected readiness locked and claim-ready accepted, got readiness=$READINESS_STATUS claimReady=$CLAIM_READY_STATUS" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.accepted !== true || s.claimReadyEvidenceAccepted !== true || s.claimChangeAllowed !== true) throw new Error("85 claim-ready gate did not unlock the claim with accepted evidence"); if (s.blockedGates.length !== 0) throw new Error(`unexpected blocked gates: ${s.blockedGates.map((g)=>g.id).join(",")}`); if (s.currentBroadNodeProductSupportClaimed !== 25 || s.candidateBroadNodeProductSupportClaimed !== 25) throw new Error("broad support claim did not move to 25");' "$WORK/claim-ready.json"

echo "node level5 85 claim-ready smoke passed: $WORK"
