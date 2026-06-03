#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-node-memory.XXXXXX")}" 
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
BASE_BUNDLE="${BASE_BUNDLE:-$ROOT/proofs/linux-vm-workload/real-cross-arch-portable-vm-all3-e2e/retained/bundle}"
SOURCE_ARCH="${SOURCE_ARCH:-arm64}"
TARGET_ARCH="${TARGET_ARCH:-$SOURCE_ARCH}"
SOURCE_NAME="portable-vm-node-memory-source-${SOURCE_ARCH}-$(date +%s)-$$"
RESTORE_NAME="portable-vm-node-memory-target-${TARGET_ARCH}-$(date +%s)-$$"
ACCEPT_SOURCE="$WORK/source-bundle-node-memory"
REFUSAL_SOURCE="$WORK/source-bundle-node-memory-refusal"
ACCEPT_SNAP="$WORK/node-memory.snap"
REFUSAL_SNAP="$WORK/node-memory-refusal.snap"
SOURCE_CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" "MACHINEN_GUEST_ARCH=$SOURCE_ARCH" node packages/cli/dist/cli.js)
TARGET_CLI=(env "MACHINEN_GUEST_ARCH=$TARGET_ARCH" node packages/cli/dist/cli.js)
cleanup() {
  "${SOURCE_CLI[@]}" stop "$SOURCE_NAME" --force --json >"$WORK/source-stop.json" 2>"$WORK/source-stop.err" || true
  "${TARGET_CLI[@]}" stop "$RESTORE_NAME" --force --json >"$WORK/target-stop.json" 2>"$WORK/target-stop.err" || true
}
trap cleanup EXIT

/usr/bin/time -p pnpm build >"$WORK/build.stdout.txt" 2>"$WORK/build.stderr.txt"

prepare_bundle() {
  local dst="$1"
  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$BASE_BUNDLE/." "$dst/"
  mkdir -p "$dst/filesystem/root/app"
  cat >"$dst/filesystem/root/app/package.json" <<'JSON'
{
  "type": "module",
  "scripts": {
    "start": "node app.mjs"
  },
  "dependencies": {}
}
JSON
  node - "$dst" <<'NODE'
const fs = require('fs');
const path = require('path');
const dst = process.argv[2];
const retained = JSON.parse(fs.readFileSync('portability/nodejs/retained/nodejs-portability-memory-real-array-report.json', 'utf8'));
fs.writeFileSync(path.join(dst, 'nodejs-memory-ir.json'), `${JSON.stringify(retained.sourceCapture.memoryIr, null, 2)}\n`);
NODE
}

prepare_bundle "$ACCEPT_SOURCE"
prepare_bundle "$REFUSAL_SOURCE"
touch "$REFUSAL_SOURCE/nodejs-memory-pending-promise.refuse"

run_snapshot() {
  local source_dir="$1"
  local snap_dir="$2"
  local prefix="$3"
  "${SOURCE_CLI[@]}" boot --name "$SOURCE_NAME" --mount-live "$source_dir:/mnt/portable-vm-source:ro" --detach --json -- sleep 100000 \
    >"$WORK/${prefix}-source-boot.json" 2>"$WORK/${prefix}-source-boot.err"
  "${SOURCE_CLI[@]}" exec "$SOURCE_NAME" -- "mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle" \
    >"$WORK/${prefix}-source-setup.out" 2>"$WORK/${prefix}-source-setup.err"
  "${SOURCE_CLI[@]}" snapshot "$SOURCE_NAME" --portable --out "$snap_dir" --json \
    >"$WORK/${prefix}-snapshot.json" 2>"$WORK/${prefix}-snapshot.err"
  "${SOURCE_CLI[@]}" stop "$SOURCE_NAME" --force --json >"$WORK/${prefix}-source-stop.json" 2>"$WORK/${prefix}-source-stop.err" || true
}

run_snapshot "$ACCEPT_SOURCE" "$ACCEPT_SNAP" accept
"${TARGET_CLI[@]}" restore "$ACCEPT_SNAP" --name "$RESTORE_NAME" --json \
  >"$WORK/accept-restore.json" 2>"$WORK/accept-restore.err"
"${TARGET_CLI[@]}" stop "$RESTORE_NAME" --force --json >"$WORK/accept-target-stop.json" 2>"$WORK/accept-target-stop.err" || true

run_snapshot "$REFUSAL_SOURCE" "$REFUSAL_SNAP" refusal
set +e
"${TARGET_CLI[@]}" restore "$REFUSAL_SNAP" --name "$RESTORE_NAME-refusal" --json \
  >"$WORK/refusal-restore.json" 2>"$WORK/refusal-restore.err"
REFUSAL_STATUS=$?
set -e
if [ "$REFUSAL_STATUS" -eq 0 ]; then
  echo "expected refusal restore to fail" >&2
  exit 1
fi

node - "$WORK" "$SOURCE_ARCH" "$TARGET_ARCH" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [work, sourceArch, targetArch] = process.argv.slice(2);
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(work, relative), 'utf8'));
const hash = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(work, relative))).digest('hex');
const acceptSnapshot = readJson('accept-snapshot.json');
const acceptRestore = readJson('accept-restore.json');
const acceptPlan = readJson('node-memory.snap/portable-vm-manifest-plan.json');
const acceptInventory = readJson('node-memory.snap/portable-vm-raw-inventory.json');
const nodeClassification = readJson('node-memory.snap/nodejs-memory-classification.json');
const nodeMemoryIr = readJson('node-memory.snap/nodejs-memory-ir.json');
const refusalSnapshot = readJson('refusal-snapshot.json');
const refusalRestore = readJson('refusal-restore.json');
const refusalPlan = readJson('node-memory-refusal.snap/portable-vm-manifest-plan.json');
if (acceptSnapshot.accepted !== true || acceptSnapshot.sourceArchitecture !== sourceArch) throw new Error('accepted snapshot did not detect source architecture');
const memoryRow = acceptPlan.restorePlan.rows.find((row) => row.id === 'nodejs-memory-ir');
if (!memoryRow || memoryRow.disposition !== 'product-supported') throw new Error('nodejs-memory-ir plan row missing');
if (memoryRow.restoreStrategy !== 'materialize-nodejs-memory-ir-target-native') throw new Error('nodejs memory restore strategy missing');
if (!acceptInventory.items.some((item) => item.id === 'nodejs-memory-ir')) throw new Error('nodejs-memory-ir inventory item missing');
if (nodeClassification.restoreStrategy !== 'materialize-nodejs-memory-ir-target-native') throw new Error('node memory classification missing restore strategy');
if (nodeMemoryIr.kind !== 'machinen.nodejs.memory-ir' || !Array.isArray(nodeMemoryIr.rows) || nodeMemoryIr.rows.length !== 1) throw new Error('memory IR not retained');
if (acceptRestore.accepted !== true || acceptRestore.sourceArch !== sourceArch || acceptRestore.targetArch !== targetArch) throw new Error('accepted restore failed');
if (acceptRestore.portableVmPlan.nodejsMemoryRows !== 1) throw new Error('restore summary missing nodejsMemoryRows');
if (acceptRestore.workloads.nodejs.memoryRows !== 1 || acceptRestore.workloads.nodejs.memoryMaterializationRows !== 1) throw new Error('restore workload summary missing memory materialization row');
if (acceptRestore.claimGuard.arbitraryVmRestoreClaimed !== false || acceptRestore.claimGuard.rawVmStateReplayUsed !== false) throw new Error('portable VM claim guard drifted');
if (refusalSnapshot.accepted !== true || refusalSnapshot.sourceArchitecture !== sourceArch) throw new Error('refusal snapshot failed');
const refusedRow = refusalPlan.restorePlan.rows.find((row) => row.refusalCode === 'node-portability-memory-pending-promise-unsupported');
if (!refusedRow || refusedRow.disposition !== 'refused') throw new Error('pending promise refusal row missing');
if (refusalRestore.accepted !== false || refusalRestore.refusal?.code !== 'node-portability-memory-pending-promise-unsupported') throw new Error('restore did not fail closed for pending promise memory');
const artifacts = [
  'accept-snapshot.json',
  'accept-restore.json',
  'node-memory.snap/portable-vm-raw-inventory.json',
  'node-memory.snap/portable-vm-manifest-plan.json',
  'node-memory.snap/nodejs-memory-ir.json',
  'node-memory.snap/nodejs-memory-classification.json',
  'refusal-snapshot.json',
  'refusal-restore.json',
  'node-memory-refusal.snap/portable-vm-manifest-plan.json',
];
const report = {
  kind: 'machinen.portable-vm-product-node-memory-ir-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'portable-vm-product-node-memory-ir-v1',
  productCommandPath: 'machinen snapshot <vm> --portable --out <bundle>; machinen restore <bundle> --json',
  sourceArchitectureDetected: true,
  targetArchitectureDetected: true,
  acceptedPath: {
    snapshotCompleted: true,
    restoreCompleted: true,
    sourceArch,
    targetArch,
    nodejsMemoryRows: acceptRestore.portableVmPlan.nodejsMemoryRows,
    memoryMaterializationRows: acceptRestore.workloads.nodejs.memoryMaterializationRows,
    restoreStrategy: memoryRow.restoreStrategy,
    memoryIrKind: nodeMemoryIr.kind,
  },
  refusalPath: {
    snapshotCompleted: true,
    restoreRefused: true,
    refusalCode: refusalRestore.refusal.code,
  },
  claimGuard: {
    ...acceptRestore.claimGuard,
    arbitraryNodeProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    samePidContinuationClaimed: false,
  },
  notClaimed: [
    'arbitrary Node process restore',
    'raw V8 heap restore',
    'same PID continuation',
    'raw VM/vCPU/device replay',
    'arbitrary Linux process restore',
  ],
  artifacts: artifacts.map((relativePath) => ({ path: relativePath, sha256: hash(relativePath) })),
};
fs.writeFileSync(path.join(work, 'portable-vm-product-node-memory-ir-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "portable VM product Node memory IR smoke passed: $WORK"
