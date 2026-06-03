#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-product.XXXXXX")}" 
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
SOURCE_BUNDLE="${SOURCE_BUNDLE:-$ROOT/proofs/linux-vm-workload/real-cross-arch-portable-vm-all3-e2e/retained/bundle}"
SOURCE_ARCH="${SOURCE_ARCH:-arm64}"
TARGET_ARCH="${TARGET_ARCH:-$SOURCE_ARCH}"
SOURCE_NAME="portable-vm-product-source-${SOURCE_ARCH}-$(date +%s)-$$"
RESTORE_NAME="portable-vm-product-target-${TARGET_ARCH}-$(date +%s)-$$"
SNAP_DIR="$WORK/portable-vm.snap"
SOURCE_CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" "MACHINEN_GUEST_ARCH=$SOURCE_ARCH" node packages/cli/dist/cli.js)
TARGET_CLI=(env "MACHINEN_GUEST_ARCH=$TARGET_ARCH" node packages/cli/dist/cli.js)
cleanup() {
  "${SOURCE_CLI[@]}" stop "$SOURCE_NAME" --force --json >"$WORK/source-stop.json" 2>"$WORK/source-stop.err" || true
  "${TARGET_CLI[@]}" stop "$RESTORE_NAME" --force --json >"$WORK/target-stop.json" 2>"$WORK/target-stop.err" || true
}
trap cleanup EXIT

/usr/bin/time -p pnpm build >"$WORK/build.stdout.txt" 2>"$WORK/build.stderr.txt"

"${SOURCE_CLI[@]}" boot --name "$SOURCE_NAME" --mount-live "$SOURCE_BUNDLE:/mnt/portable-vm-source:ro" --detach --json -- sleep 100000 \
  >"$WORK/source-boot.json" 2>"$WORK/source-boot.err"
"${SOURCE_CLI[@]}" exec "$SOURCE_NAME" -- "mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle" \
  >"$WORK/source-setup.out" 2>"$WORK/source-setup.err"
"${SOURCE_CLI[@]}" snapshot "$SOURCE_NAME" --portable --out "$SNAP_DIR" --json \
  >"$WORK/snapshot.json" 2>"$WORK/snapshot.err"
"${TARGET_CLI[@]}" restore "$SNAP_DIR" --name "$RESTORE_NAME" --json \
  >"$WORK/restore.json" 2>"$WORK/restore.err"

node - "$WORK" "$SOURCE_ARCH" "$TARGET_ARCH" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [work, sourceArch, targetArch] = process.argv.slice(2);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(work, name), 'utf8'));
const snapshot = readJson('snapshot.json');
const restore = readJson('restore.json');
if (snapshot.accepted !== true || snapshot.sourceArchitecture !== sourceArch || snapshot.sourceArchitectureDetected !== true) throw new Error('portable snapshot did not detect source arch');
if (snapshot.sourcePathDetection !== 'guest portable VM inventory agent') throw new Error('portable snapshot did not use guest inventory agent path');
const plan = readJson('portable-vm.snap/portable-vm-manifest-plan.json');
const inventory = readJson('portable-vm.snap/portable-vm-raw-inventory.json');
if (plan.kind !== 'machinen.portable-vm-manifest-plan' || plan.targetPolicy.unknownStatePolicy !== 'refuse-by-default') throw new Error('portable VM plan missing claim guard policy');
if (!Array.isArray(plan.restorePlan.rows) || plan.restorePlan.rows.length !== 3) throw new Error('portable VM plan did not classify all-three rows');
if (inventory.kind !== 'machinen.portable-vm-raw-inventory' || inventory.items.length !== 3) throw new Error('portable VM raw inventory missing rows');
if (restore.accepted !== true || restore.sourceArch !== sourceArch || restore.targetArch !== targetArch || restore.targetArchitectureDetected !== true) throw new Error('portable restore did not detect target arch');
if (restore.portableVmPlan?.kind !== 'machinen.portable-vm-manifest-plan' || restore.portableVmPlan.productSupportedRows !== 3) throw new Error('portable restore did not consume the portability plan');
if (restore.migrationCompleted !== true || restore.targetVmStarted !== true) throw new Error('portable restore did not boot target VM');
if (restore.workloads.filesystem !== true || restore.workloads.service !== true || restore.workloads.sqlite !== true) throw new Error('portable restore workloads did not verify');
if (restore.claimGuard.arbitraryVmRestoreClaimed !== false || restore.claimGuard.rawVmStateReplayUsed !== false) throw new Error('claim guard drifted');
const files = ['snapshot.json', 'restore.json', 'portable-vm.snap/portable-vm-snapshot-summary.json', 'portable-vm.snap/portable-vm-product-restore-summary.json', 'portable-vm.snap/source-architecture.txt', 'portable-vm.snap/portable-vm-all3-manifest.json', 'portable-vm.snap/portable-vm-raw-inventory.json', 'portable-vm.snap/portable-vm-manifest-plan.json'];
const report = {
  kind: 'machinen.portable-vm-product-snapshot-restore-e2e-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'portable-vm-all3-product-snapshot-restore-v1',
  productCommandPath: 'machinen snapshot <vm> --portable --out <bundle>; machinen restore <bundle> --json',
  sourceArchitectureDetected: true,
  targetArchitectureDetected: true,
  result: {
    snapshotCompleted: true,
    restoreCompleted: true,
    migrationCompleted: true,
    sourceArch,
    targetArch,
    crossArchitecture: sourceArch !== targetArch,
    crossArchitectureProductHostAvailable: sourceArch !== targetArch,
    targetNativeVmBooted: true,
    targetVerifierPassed: true,
    filesystemVerified: restore.workloads.filesystem,
    serviceVerified: restore.workloads.service,
    sqliteVerified: restore.workloads.sqlite,
  },
  claimGuard: restore.claimGuard,
  artifacts: files.map((relativePath) => ({
    path: relativePath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(work, relativePath))).digest('hex'),
  })),
};
fs.writeFileSync(path.join(work, 'portable-vm-product-snapshot-restore-e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "portable VM product snapshot/restore smoke passed: $WORK"
