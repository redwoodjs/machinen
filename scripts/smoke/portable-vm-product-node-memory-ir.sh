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
  cat >"$dst/target-restore.sh" <<'SH'
#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
mkdir -p "$TARGET"
rm -rf "$FSROOT"
mkdir -p "$FSROOT"
cp -a /mnt/capture/filesystem/root/. "$FSROOT/"
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get update >/tmp/machinen-all3-apt-update.log 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sqlite3 >/tmp/machinen-all3-apt-install.log 2>&1
fi
DB="$TARGET/app.db"
rm -f "$DB"
sqlite3 "$DB" < /mnt/capture/sqlite-dump.sql
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
COUNT_GOT=$(sqlite3 "$DB" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$DB" 'select sum(qty) from items;')
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
cat > "$TARGET/service.pl" <<'PL'
use strict;
use warnings;
use IO::Socket::INET;
my $port = $ENV{MACHINEN_ALL3_SERVICE_PORT} || 18181;
my $body = ($ENV{MACHINEN_ALL3_SERVICE_RESPONSE} || 'machinen-portable-service-v1') . "\n";
my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Proto => 'tcp', Listen => 16, Reuse => 1) or die "listen: $!\n";
$SIG{TERM} = sub { exit 0; };
while (my $client = $server->accept()) {
  my $buf = '';
  sysread($client, $buf, 4096);
  print $client "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n" . $body;
  close($client);
}
PL
rm -f /tmp/machinen-all3-service.log /tmp/machinen-all3-service.pid
MACHINEN_ALL3_SERVICE_PORT=18181 MACHINEN_ALL3_SERVICE_RESPONSE="$EXPECTED_RESPONSE" perl "$TARGET/service.pl" >/tmp/machinen-all3-service.log 2>&1 &
echo $! >/tmp/machinen-all3-service.pid
NODE_MEMORY_MATERIALIZED=false
NODE_MEMORY_ROWS=0
NODE_MEMORY_PID=0
if [ -f /mnt/capture/nodejs-memory-ir.json ]; then
  cat >/tmp/machinen-node-env.sh <<'NODEENV'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=sh)"
  fnm use 22.13.1 >/dev/null 2>&1 || fnm install 22.13.1 >/dev/null 2>&1 || true
  eval "$(fnm env --shell=sh)"
fi
NODEENV
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if ! command -v node >/dev/null 2>&1; then
    apt-get update >/tmp/machinen-node-apt-update.log 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs >/tmp/machinen-node-apt-install.log 2>&1
  fi
  node <<'NODEAPP'
const fs = require('fs');
const ir = JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json', 'utf8'));
const state = ir.rows[0]?.semanticState ?? {};
fs.writeFileSync('/opt/machinen-all3/node-memory-state.json', `${JSON.stringify(state, null, 2)}\n`);
fs.writeFileSync('/opt/machinen-all3/node-memory-app.mjs', `import http from "node:http";\nconst state = ${JSON.stringify(state)};\nglobalThis.__machinenMaterializedNodeMemoryState = state;\nhttp.createServer((req, res) => {\n  if (req.url === "/state") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(state)); return; }\n  if (req.url === "/value") { res.end("memory-ready"); return; }\n  res.writeHead(404); res.end("not found");\n}).listen(18182, "127.0.0.1");\n`);
fs.writeFileSync('/opt/machinen-all3/node-memory-ir-summary.json', JSON.stringify({ kind: ir.kind, materializedRows: ir.rows.length }, null, 2) + '\n');
NODEAPP
  rm -f /tmp/machinen-node-memory.log /tmp/machinen-node-memory.pid
  node "$TARGET/node-memory-app.mjs" >/tmp/machinen-node-memory.log 2>&1 &
  NODE_MEMORY_PID=$!
  echo "$NODE_MEMORY_PID" >/tmp/machinen-node-memory.pid
  NODE_MEMORY_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_MEMORY_MATERIALIZED=true
fi
cat > /tmp/machinen-all3-target-restore.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-restore",
  "accepted": true,
  "filesystemRestored": true,
  "sqliteRestored": { "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "sqliteExpected": { "count": $COUNT, "qtySum": $QTY_SUM },
  "serviceStarted": true,
  "servicePid": $(cat /tmp/machinen-all3-service.pid),
  "nodejsMemory": { "materialized": $NODE_MEMORY_MATERIALIZED, "materializedRows": $NODE_MEMORY_ROWS, "pid": $NODE_MEMORY_PID }
}
JSON
cat /tmp/machinen-all3-target-restore.json
SH
  cat >"$dst/target-verify.sh" <<'SH'
#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
if (cd "$FSROOT" && sha256sum -c /mnt/capture/filesystem-sha256.txt >/tmp/machinen-all3-fs-verify.log 2>&1); then
  FS_OK=true
else
  FS_OK=false
fi
COUNT_GOT=$(sqlite3 "$TARGET/app.db" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$TARGET/app.db" 'select sum(qty) from items;')
if [ "$COUNT_GOT" = "$COUNT" ] && [ "$QTY_SUM_GOT" = "$QTY_SUM" ]; then
  SQLITE_OK=true
else
  SQLITE_OK=false
fi
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
SERVICE_BODY=$(perl -MIO::Socket::INET -e 'my $s=IO::Socket::INET->new(PeerAddr=>"127.0.0.1",PeerPort=>18181,Proto=>"tcp",Timeout=>5) or exit 7; print $s "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"; local $/; my $r=<$s>; $r =~ s/^.*?\r?\n\r?\n//s; $r =~ s/\r?\n$//; print $r;')
if [ "$SERVICE_BODY" = "$EXPECTED_RESPONSE" ]; then
  SERVICE_OK=true
else
  SERVICE_OK=false
fi
NODE_OK=false
NODE_ROWS=0
NODE_KIND=null
if [ -f /mnt/capture/nodejs-memory-ir.json ]; then
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if node <<'NODEVERIFY'
const assert = require('assert/strict');
const fs = require('fs');
(async () => {
  const ir = JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json', 'utf8'));
  const expected = ir.rows[0]?.semanticState ?? {};
  const actual = await fetch('http://127.0.0.1:18182/state').then((res) => res.json());
  assert.deepEqual(actual, expected);
})().catch((error) => { console.error(error); process.exit(1); });
NODEVERIFY
  then
    NODE_OK=true
  fi
  NODE_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_KIND=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(JSON.stringify(ir.kind))")
else
  NODE_OK=true
  NODE_KIND=null
fi
if [ "$FS_OK" = true ] && [ "$SQLITE_OK" = true ] && [ "$SERVICE_OK" = true ] && [ "$NODE_OK" = true ]; then
  ACCEPTED=true
else
  ACCEPTED=false
fi
cat > /tmp/machinen-all3-target-verify.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-verifier",
  "accepted": $ACCEPTED,
  "filesystem": { "accepted": $FS_OK, "files": $(wc -l < /mnt/capture/filesystem-sha256.txt | tr -d ' ') },
  "sqlite": { "accepted": $SQLITE_OK, "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "service": { "accepted": $SERVICE_OK, "status": 200, "body": "$SERVICE_BODY" },
  "nodejsMemory": { "accepted": $NODE_OK, "memoryIrKind": $NODE_KIND, "materializedRows": $NODE_ROWS }
}
JSON
cat /tmp/machinen-all3-target-verify.json
[ "$ACCEPTED" = true ]
SH
  chmod +x "$dst/target-restore.sh" "$dst/target-verify.sh"
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
if (acceptRestore.workloads.nodejs.memoryVerified !== true || acceptRestore.workloads.nodejs.memoryMaterializedRows !== 1) throw new Error('restore workload summary missing verified Node memory materialization');
if (acceptRestore.targetRestore.nodejsMemory?.materialized !== true || acceptRestore.targetRestore.nodejsMemory?.materializedRows !== 1) throw new Error('target restore did not materialize Node memory IR');
if (acceptRestore.targetVerify.nodejsMemory?.accepted !== true || acceptRestore.targetVerify.nodejsMemory?.memoryIrKind !== 'machinen.nodejs.memory-ir') throw new Error('target verifier did not verify Node memory IR app');
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
    memoryVerified: acceptRestore.workloads.nodejs.memoryVerified,
    materializedRows: acceptRestore.workloads.nodejs.memoryMaterializedRows,
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
