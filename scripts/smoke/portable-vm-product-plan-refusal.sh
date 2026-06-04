#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-plan-refusal.XXXXXX")}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
SNAP_DIR="$WORK/refused-portable-vm.snap"
SOURCE_BUNDLE="$ROOT/proofs/linux-vm-workload/real-cross-arch-portable-vm-all3-e2e/retained/bundle"

cp -a "$SOURCE_BUNDLE" "$SNAP_DIR"
printf 'arm64\n' >"$SNAP_DIR/source-architecture.txt"
cat >"$SNAP_DIR/portable-vm-manifest-plan.json" <<'JSON'
{
  "kind": "machinen.portable-vm-manifest-plan",
  "version": 1,
  "status": "product-generated",
  "scope": "portable-vm-all3-product-snapshot-restore-v1",
  "sourceArchitecture": "arm64",
  "sourceArchitectureDetected": true,
  "targetPolicy": {
    "restoreMode": "target-native-reconstruction",
    "allowedTargetArchitectures": ["arm64", "amd64"],
    "unknownStatePolicy": "refuse-by-default",
    "architectureDetection": "detect-target-architecture-at-restore-time"
  },
  "restorePlan": {
    "rows": [
      { "id": "filesystem-root", "category": "filesystem", "disposition": "product-supported", "restoreStrategy": "copy-content-addressed-file-tree", "artifact": "filesystem-manifest.json" },
      { "id": "selected-service", "category": "service", "disposition": "product-supported", "restoreStrategy": "start-target-native-selected-service", "artifact": "service-manifest.json" },
      { "id": "clean-sqlite", "category": "sqlite", "disposition": "product-supported", "restoreStrategy": "restore-clean-logical-sqlite-dump", "artifact": "sqlite-logical.json" },
      { "id": "active-network-stream", "category": "network", "disposition": "refused", "refusalCode": "portable-vm-active-network-stream-unsupported", "message": "active network streams are refused; only listener reconstruction is supported" }
    ]
  },
  "claimGuard": {
    "arbitraryVmRestoreClaimed": false,
    "rawVmStateReplayUsed": false,
    "sourceIsaEmulationUsed": false,
    "metadataOnlyShortcutAccepted": false
  }
}
JSON

set +e
MACHINEN_GUEST_ARCH=arm64 node packages/cli/dist/cli.js restore "$SNAP_DIR" --name refused-portable-vm --json >"$WORK/restore.json" 2>"$WORK/restore.err"
code=$?
set -e
if [ "$code" -eq 0 ]; then
  echo "expected portable VM restore refusal, got success" >&2
  exit 1
fi
node - "$WORK/restore.json" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const summary = JSON.parse(fs.readFileSync(path, 'utf8'));
if (summary.accepted !== false) throw new Error('restore was not refused');
if (summary.refusal?.code !== 'portable-vm-active-network-stream-unsupported') throw new Error(`wrong refusal code: ${summary.refusal?.code}`);
if (summary.targetVmStarted === true) throw new Error('refusal should occur before target VM boot');
if (summary.claimGuard?.arbitraryVmRestoreClaimed !== false) throw new Error('claim guard drifted');
console.log(JSON.stringify(summary, null, 2));
NODE

echo "portable VM plan refusal smoke passed: $WORK"
