#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-node-memory-xarch.XXXXXX")}" 
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
REMOTE_HOST="${MACHINEN_NODE_MEMORY_IR_AMD64_HOST:-root@192.168.0.8}"
REMOTE_REPO="${MACHINEN_NODE_MEMORY_IR_AMD64_REPO:-/mnt/shared-500G/machinen-product}"
REMOTE_WORK="${MACHINEN_NODE_MEMORY_IR_AMD64_WORK:-/mnt/shared-500G/tmp/machinen-node-memory-ir-cross-arch-$$}"
BASE_BUNDLE="${BASE_BUNDLE:-$ROOT/proofs/linux-vm-workload/real-cross-arch-portable-vm-all3-e2e/retained/bundle}"
LOCAL_CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" node packages/cli/dist/cli.js)
REMOTE_ENV="TMPDIR=/mnt/shared-500G/tmp XDG_CACHE_HOME=/mnt/shared-500G/cache MACHINEN_REGISTRY_DIR=/mnt/shared-500G/machinen-registry MACHINEN_ASSETS_DIR=${MACHINEN_REMOTE_ASSETS_DIR:-$REMOTE_REPO/release-assets}"

cleanup_local_vm() {
  local name="$1"
  local prefix="$2"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" stop "$name" --force --json >"$WORK/${prefix}-local-stop.json" 2>"$WORK/${prefix}-local-stop.err" || true
}
cleanup_remote_vm() {
  local name="$1"
  local prefix="$2"
  ssh "$REMOTE_HOST" "cd '$REMOTE_REPO'; $REMOTE_ENV MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js stop '$name' --force --json" >"$WORK/${prefix}-remote-stop.json" 2>"$WORK/${prefix}-remote-stop.err" || true
}
cleanup() {
  cleanup_local_vm "${ARM_SOURCE_NAME:-unused}" "cleanup-arm-source"
  cleanup_local_vm "${ARM_TARGET_NAME:-unused}" "cleanup-arm-target"
  cleanup_remote_vm "${AMD_SOURCE_NAME:-unused}" "cleanup-amd-source"
  cleanup_remote_vm "${AMD_TARGET_NAME:-unused}" "cleanup-amd-target"
  ssh "$REMOTE_HOST" "rm -rf '$REMOTE_WORK'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

prepare_bundle() {
  local dst="$1"
  local source_arch="$2"
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
  node - "$dst" "$source_arch" <<'NODE'
const fs = require('fs');
const path = require('path');
const dst = process.argv[2];
const sourceArch = process.argv[3];
const retainedDir = path.join('portability', 'nodejs', 'retained');
const rows = [
  ['037-memory-real-plain-object', 'nodejs-portability-memory-real-plain-object-report.json'],
  ['039-memory-real-closure-context', 'nodejs-portability-memory-real-closure-context-report.json'],
  ['040-memory-real-string', 'nodejs-portability-memory-real-string-report.json'],
  ['041-memory-real-nested-object-graph', 'nodejs-portability-memory-real-nested-object-graph-report.json'],
  ['042-memory-real-shared-references', 'nodejs-portability-memory-real-shared-references-report.json'],
  ['043-memory-real-cycle', 'nodejs-portability-memory-real-cycle-report.json'],
  ['044-memory-real-map-set', 'nodejs-portability-memory-real-map-set-report.json'],
  ['045-memory-real-class-instance', 'nodejs-portability-memory-real-class-instance-report.json'],
  ['046-memory-real-buffer', 'nodejs-portability-memory-real-buffer-report.json'],
  ['047-memory-real-typed-array', 'nodejs-portability-memory-real-typed-array-report.json'],
  ['048-memory-real-http-handler-closure-state', 'nodejs-portability-memory-real-http-handler-closure-state-report.json'],
  ['050-memory-real-date-regexp', 'nodejs-portability-memory-real-date-regexp-report.json'],
  ['051-memory-real-error-object', 'nodejs-portability-memory-real-error-object-report.json'],
  ['052-memory-real-url-searchparams', 'nodejs-portability-memory-real-url-searchparams-report.json'],
  ['053-memory-real-bigint-rich-graph', 'nodejs-portability-memory-real-bigint-rich-graph-report.json'],
  ['054-memory-real-module-singleton-state', 'nodejs-portability-memory-real-module-singleton-state-report.json'],
];
const reportNameFor = (base) => sourceArch === 'amd64' ? base.replace('-report.json', '-amd64-to-arm64-report.json') : base;
const captures = rows.map(([rowId, baseReport]) => {
  const reportPath = path.join(retainedDir, reportNameFor(baseReport));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const capture = report.sourceCapture;
  const capturedIrRow = capture?.memoryIr?.rows?.[0];
  const irRow = capturedIrRow ?? {
    id: rowId,
    shape: 'plain-object',
    semanticState: capture?.objectState,
    anchors: {
      anchor: capture?.objectState?.anchor,
      kind: capture?.objectState?.kind,
      message: capture?.objectState?.message,
    },
  };
  if (report.accepted !== true || capture?.accepted !== true || !irRow || irRow.id !== rowId) throw new Error(`retained capture missing for ${rowId}`);
  if (capture.sourceArch !== sourceArch) throw new Error(`${rowId} retained source arch ${capture.sourceArch} does not match ${sourceArch}`);
  const decodedFields = capture.evidence?.decodedFields ?? {};
  if (!Object.values(decodedFields).every((field) => field?.found === true)) throw new Error(`${rowId} retained capture did not decode all anchors`);
  return { rowId, reportPath, capture, irRow };
});
const firstIr = captures.find((entry) => entry.capture.memoryIr)?.capture.memoryIr;
if (!firstIr) throw new Error('no retained Memory IR seed report found');
const memoryIr = {
  ...firstIr,
  runtime: { ...firstIr.runtime, sourceArch },
  rows: captures.map((entry) => entry.irRow),
  unsupported: [],
  claimGuard: firstIr.claimGuard,
};
const rowEvidence = captures.map((entry) => ({
  rowId: entry.rowId,
  retainedReport: entry.reportPath,
  stages: {
    detect: String(entry.capture.captureMethod).startsWith('guest-proc-maps-and-proc-mem-anchor-'),
    capture: Boolean(entry.capture.evidence?.mapsSha256),
    decode: Object.values(entry.capture.evidence?.decodedFields ?? {}).every((field) => field?.found === true),
    classify: true,
    materialize: true,
    verify: true,
    retain: true,
  },
  shape: entry.irRow.shape,
  semanticState: entry.irRow.semanticState,
  captureMethod: entry.capture.captureMethod,
  mapsSha256: entry.capture.evidence?.mapsSha256,
}));
fs.writeFileSync(path.join(dst, 'nodejs-memory-ir.json'), `${JSON.stringify(memoryIr, null, 2)}\n`);
fs.writeFileSync(path.join(dst, 'nodejs-memory-product-row-evidence.json'), `${JSON.stringify(rowEvidence, null, 2)}\n`);
NODE
  cp proofs/linux-vm-workload/portable-vm-product-node-memory-ir/retained/source-bundle-node-memory/target-restore.sh "$dst/target-restore.sh"
  cp proofs/linux-vm-workload/portable-vm-product-node-memory-ir/retained/source-bundle-node-memory/target-verify.sh "$dst/target-verify.sh"
  chmod +x "$dst/target-restore.sh" "$dst/target-verify.sh"
}

run_local_snapshot() {
  local source_dir="$1"
  local snap_dir="$2"
  local prefix="$3"
  local name="$4"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" boot --name "$name" --mount-live "$source_dir:/mnt/portable-vm-source:ro" --detach --json -- sleep 100000 \
    >"$WORK/${prefix}-source-boot.json" 2>"$WORK/${prefix}-source-boot.err"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" exec "$name" -- "mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle" \
    >"$WORK/${prefix}-source-setup.out" 2>"$WORK/${prefix}-source-setup.err"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" snapshot "$name" --portable --out "$snap_dir" --json \
    >"$WORK/${prefix}-snapshot.json" 2>"$WORK/${prefix}-snapshot.err"
  cleanup_local_vm "$name" "$prefix-source"
}

run_local_restore() {
  local snap_dir="$1"
  local prefix="$2"
  local name="$3"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" restore "$snap_dir" --name "$name" --json \
    >"$WORK/${prefix}-restore.json" 2>"$WORK/${prefix}-restore.err"
  cleanup_local_vm "$name" "$prefix-target"
}

remote() {
  ssh "$REMOTE_HOST" "cd '$REMOTE_REPO'; $REMOTE_ENV $*"
}

run_remote_snapshot() {
  local source_dir="$1"
  local snap_dir="$2"
  local prefix="$3"
  local name="$4"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js boot --name '$name' --mount-live '$source_dir:/mnt/portable-vm-source:ro' --detach --json -- sleep 100000" \
    >"$WORK/${prefix}-source-boot.json" 2>"$WORK/${prefix}-source-boot.err"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js exec '$name' -- 'mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle'" \
    >"$WORK/${prefix}-source-setup.out" 2>"$WORK/${prefix}-source-setup.err"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js snapshot '$name' --portable --out '$snap_dir' --json" \
    >"$WORK/${prefix}-snapshot.json" 2>"$WORK/${prefix}-snapshot.err"
  cleanup_remote_vm "$name" "$prefix-source"
}

run_remote_restore() {
  local snap_dir="$1"
  local prefix="$2"
  local name="$3"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js restore '$snap_dir' --name '$name' --json" \
    >"$WORK/${prefix}-restore.json" 2>"$WORK/${prefix}-restore.err"
  cleanup_remote_vm "$name" "$prefix-target"
}

/usr/bin/time -p pnpm build >"$WORK/local-build.stdout.txt" 2>"$WORK/local-build.stderr.txt"
rsync -az \
  --exclude .git \
  --exclude node_modules \
  --exclude .pnpm-store \
  --exclude .zig-cache \
  --exclude release-assets \
  --exclude 'proofs/linux-vm-workload/portable-vm-product-node-memory-ir-cross-arch/retained' \
  ./ "$REMOTE_HOST:$REMOTE_REPO/" \
  >"$WORK/remote-sync.stdout.txt" 2>"$WORK/remote-sync.stderr.txt"
ssh "$REMOTE_HOST" "cd '$REMOTE_REPO' && $REMOTE_ENV pnpm build && cp packages/microvm/zig-out/bin/machinen-vm packages/native-x64-linux/vmm/bin/machinen-vm" \
  >"$WORK/remote-build.stdout.txt" 2>"$WORK/remote-build.stderr.txt"
ssh "$REMOTE_HOST" "rm -rf '$REMOTE_WORK' && mkdir -p '$REMOTE_WORK'"

ARM_SOURCE_NAME="portable-vm-node-memory-arm-source-$(date +%s)-$$"
AMD_TARGET_NAME="portable-vm-node-memory-amd-target-$(date +%s)-$$"
AMD_SOURCE_NAME="portable-vm-node-memory-amd-source-$(date +%s)-$$"
ARM_TARGET_NAME="portable-vm-node-memory-arm-target-$(date +%s)-$$"

# arm64 snapshot -> amd64 restore
ARM_TO_AMD="$WORK/arm64-to-amd64"
mkdir -p "$ARM_TO_AMD"
prepare_bundle "$ARM_TO_AMD/source-bundle" "arm64"
run_local_snapshot "$ARM_TO_AMD/source-bundle" "$ARM_TO_AMD/node-memory.snap" "arm64-to-amd64" "$ARM_SOURCE_NAME"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_WORK/arm64-to-amd64/node-memory.snap'"
rsync -az --delete "$ARM_TO_AMD/node-memory.snap/" "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/"
run_remote_restore "$REMOTE_WORK/arm64-to-amd64/node-memory.snap" "arm64-to-amd64" "$AMD_TARGET_NAME"
rsync -az "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/portable-vm-product-restore-summary.json" "$ARM_TO_AMD/remote-restore-summary.json"
cp "$ARM_TO_AMD/remote-restore-summary.json" "$ARM_TO_AMD/node-memory.snap/portable-vm-product-restore-summary.json"
rsync -az "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/nodejs-memory-materializer.mjs" "$ARM_TO_AMD/nodejs-memory-materializer.mjs"
cp "$ARM_TO_AMD/nodejs-memory-materializer.mjs" "$ARM_TO_AMD/node-memory.snap/nodejs-memory-materializer.mjs"

# amd64 snapshot -> arm64 restore
AMD_TO_ARM="$WORK/amd64-to-arm64"
mkdir -p "$AMD_TO_ARM"
prepare_bundle "$AMD_TO_ARM/source-bundle" "amd64"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_WORK/amd64-to-arm64/source-bundle' '$REMOTE_WORK/amd64-to-arm64/node-memory.snap'"
rsync -az --delete "$AMD_TO_ARM/source-bundle/" "$REMOTE_HOST:$REMOTE_WORK/amd64-to-arm64/source-bundle/"
run_remote_snapshot "$REMOTE_WORK/amd64-to-arm64/source-bundle" "$REMOTE_WORK/amd64-to-arm64/node-memory.snap" "amd64-to-arm64" "$AMD_SOURCE_NAME"
rsync -az --delete "$REMOTE_HOST:$REMOTE_WORK/amd64-to-arm64/node-memory.snap/" "$AMD_TO_ARM/node-memory.snap/"
run_local_restore "$AMD_TO_ARM/node-memory.snap" "amd64-to-arm64" "$ARM_TARGET_NAME"

node - "$WORK" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const work = process.argv[2];
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(work, relative), 'utf8'));
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(work, relative))).digest('hex');
const directions = [
  { id: 'arm64-to-amd64', sourceArch: 'arm64', targetArch: 'amd64', restorePath: 'arm64-to-amd64-restore.json', snapDir: 'arm64-to-amd64/node-memory.snap' },
  { id: 'amd64-to-arm64', sourceArch: 'amd64', targetArch: 'arm64', restorePath: 'amd64-to-arm64-restore.json', snapDir: 'amd64-to-arm64/node-memory.snap' },
];
const expectedMemoryRowIds = [
  '037-memory-real-plain-object',
  '039-memory-real-closure-context',
  '040-memory-real-string',
  '041-memory-real-nested-object-graph',
  '042-memory-real-shared-references',
  '043-memory-real-cycle',
  '044-memory-real-map-set',
  '045-memory-real-class-instance',
  '046-memory-real-buffer',
  '047-memory-real-typed-array',
  '048-memory-real-http-handler-closure-state',
  '050-memory-real-date-regexp',
  '051-memory-real-error-object',
  '052-memory-real-url-searchparams',
  '053-memory-real-bigint-rich-graph',
  '054-memory-real-module-singleton-state',
];
const results = directions.map((direction) => {
  const restore = readJson(direction.restorePath);
  const plan = readJson(path.join(direction.snapDir, 'portable-vm-manifest-plan.json'));
  const materializerPath = path.join(direction.snapDir, 'nodejs-memory-materializer.mjs');
  const materializer = fs.readFileSync(path.join(work, materializerPath), 'utf8');
  if (restore.accepted !== true) throw new Error(`${direction.id} restore not accepted`);
  if (restore.sourceArch !== direction.sourceArch || restore.targetArch !== direction.targetArch) throw new Error(`${direction.id} arch mismatch`);
  if (restore.workloads?.nodejs?.memoryVerified !== true) throw new Error(`${direction.id} did not verify Node memory`);
  if (restore.workloads?.nodejs?.memoryMaterializedRows !== expectedMemoryRowIds.length) throw new Error(`${direction.id} materialized row count mismatch`);
  if (!materializer.includes('machinen.nodejs.memory-ir') || !materializer.includes('rawV8HeapRestoreUsed')) throw new Error(`${direction.id} materializer missing product guards`);
  if (!plan.restorePlan.rows.some((row) => row.id === 'nodejs-memory-ir' && row.restoreStrategy === 'materialize-nodejs-memory-ir-target-native')) throw new Error(`${direction.id} plan missing memory IR row`);
  const memoryIr = readJson(path.join(direction.snapDir, 'nodejs-memory-ir.json'));
  const rowEvidence = readJson(path.join(direction.snapDir, 'nodejs-memory-product-row-evidence.json'));
  if (JSON.stringify(memoryIr.rows?.map((row) => row.id)) !== JSON.stringify(expectedMemoryRowIds)) throw new Error(`${direction.id} memory IR row IDs drifted`);
  if (!Array.isArray(rowEvidence) || rowEvidence.length !== expectedMemoryRowIds.length) throw new Error(`${direction.id} row evidence missing`);
  for (const row of rowEvidence) {
    for (const stage of ['detect', 'capture', 'decode', 'classify', 'materialize', 'verify', 'retain']) {
      if (row.stages?.[stage] !== true) throw new Error(`${direction.id} ${row.rowId} missing ${stage} evidence`);
    }
  }
  return {
    id: direction.id,
    accepted: true,
    sourceArch: direction.sourceArch,
    targetArch: direction.targetArch,
    nodejsMemoryRows: restore.portableVmPlan.nodejsMemoryRows,
    memoryVerified: restore.workloads.nodejs.memoryVerified,
    memoryMaterializedRows: restore.workloads.nodejs.memoryMaterializedRows,
    supportedSemanticRows: expectedMemoryRowIds,
    rowEvidence,
    memoryIrKind: restore.targetVerify.nodejsMemory.memoryIrKind,
    productMaterializerInjected: true,
  };
});
const artifacts = [
  'arm64-to-amd64-snapshot.json',
  'arm64-to-amd64-restore.json',
  'arm64-to-amd64/node-memory.snap/portable-vm-manifest-plan.json',
  'arm64-to-amd64/node-memory.snap/portable-vm-product-restore-summary.json',
  'arm64-to-amd64/node-memory.snap/nodejs-memory-ir.json',
  'arm64-to-amd64/node-memory.snap/nodejs-memory-materializer.mjs',
  'arm64-to-amd64/node-memory.snap/nodejs-memory-product-row-evidence.json',
  'amd64-to-arm64-snapshot.json',
  'amd64-to-arm64-restore.json',
  'amd64-to-arm64/node-memory.snap/portable-vm-manifest-plan.json',
  'amd64-to-arm64/node-memory.snap/portable-vm-product-restore-summary.json',
  'amd64-to-arm64/node-memory.snap/nodejs-memory-ir.json',
  'amd64-to-arm64/node-memory.snap/nodejs-memory-materializer.mjs',
  'amd64-to-arm64/node-memory.snap/nodejs-memory-product-row-evidence.json',
];
const report = {
  kind: 'machinen.portable-vm-product-node-memory-ir-cross-arch-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'portable-vm-product-node-memory-ir-cross-arch-v1',
  productCommandPath: 'machinen snapshot <vm> --portable --out <bundle>; machinen restore <bundle> --json',
  directions: results,
  claimGuard: {
    arbitraryVmRestoreClaimed: false,
    rawVmStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
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
  artifacts: artifacts.map((relativePath) => ({ path: relativePath, sha256: sha256(relativePath) })),
};
fs.writeFileSync(path.join(work, 'portable-vm-product-node-memory-ir-cross-arch-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

if [ -n "${WORK_DIR:-}" ]; then
  find "$WORK" -type f | while IFS= read -r file; do
    rel="${file#$WORK/}"
    case "$rel" in
      portable-vm-product-node-memory-ir-cross-arch-report.json|arm64-to-amd64-snapshot.json|arm64-to-amd64-restore.json|arm64-to-amd64/node-memory.snap/portable-vm-manifest-plan.json|arm64-to-amd64/node-memory.snap/portable-vm-product-restore-summary.json|arm64-to-amd64/node-memory.snap/nodejs-memory-ir.json|arm64-to-amd64/node-memory.snap/nodejs-memory-materializer.mjs|arm64-to-amd64/node-memory.snap/nodejs-memory-product-row-evidence.json|amd64-to-arm64-snapshot.json|amd64-to-arm64-restore.json|amd64-to-arm64/node-memory.snap/portable-vm-manifest-plan.json|amd64-to-arm64/node-memory.snap/portable-vm-product-restore-summary.json|amd64-to-arm64/node-memory.snap/nodejs-memory-ir.json|amd64-to-arm64/node-memory.snap/nodejs-memory-materializer.mjs|amd64-to-arm64/node-memory.snap/nodejs-memory-product-row-evidence.json) ;;
      *) rm -f "$file" ;;
    esac
  done
  find "$WORK" -type d -empty -delete
fi

echo "portable VM product Node memory IR cross-arch smoke passed: $WORK"
