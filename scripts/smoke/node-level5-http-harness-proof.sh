#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-http-harness.XXXXXX")}"
SOURCE="node-level5-http-source-$$"
TARGET="node-level5-http-target-$$"
SOURCE_PORT=$((31000 + ($$ % 1000)))
TARGET_PORT=$((33000 + ($$ % 1000)))
mkdir -p "$WORK"

cleanup() {
  node "$CLI" stop "$SOURCE" >/dev/null 2>&1 || true
  node "$CLI" stop "$TARGET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export MACHINEN_ASSETS_DIR="${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}"
export MACHINEN_REGISTRY_DIR="$WORK/registry"

assert_count() {
  local body="$1"
  local expected="$2"
  node -e 'const body=process.argv[1]; const expected=Number(process.argv[2]); const parsed=JSON.parse(body); if (parsed.count !== expected) throw new Error(`expected count ${expected}, got ${body}`);' "$body" "$expected"
}

node "$CLI" boot --name "$SOURCE" --detach -p "${SOURCE_PORT}:3000" -- sleep 100000 >/dev/null
node "$CLI" exec "$SOURCE" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null"
node "$CLI" exec "$SOURCE" -- "mkdir -p /opt/machinen-node-level5-http-product && cat >/opt/machinen-node-level5-http-product/counter.mjs <<'JS'
import { createServer } from 'node:http';
let count = 0;
createServer((req, res) => {
  if (req.url === '/__ready') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ready\n');
    return;
  }
  if (req.url !== '/') {
    res.writeHead(404);
    res.end('not found\n');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ count: ++count }) + '\n');
}).listen(3000, '127.0.0.1');
JS
cd /opt/machinen-node-level5-http-product && nohup node counter.mjs >/tmp/node-level5-http-product.log 2>&1 &"
node "$CLI" exec "$SOURCE" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/__ready >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/node-level5-http-product.log; exit 1"

SOURCE_ONE="$(node "$CLI" exec "$SOURCE" -- "curl -fsS http://127.0.0.1:3000/" | tr -d '\r')"
SOURCE_TWO="$(node "$CLI" exec "$SOURCE" -- "curl -fsS http://127.0.0.1:3000/" | tr -d '\r')"
assert_count "$SOURCE_ONE" 1
assert_count "$SOURCE_TWO" 2

node "$CLI" snapshot "$SOURCE" "$WORK/snap" --json >"$WORK/snapshot.json"
node -e '
const fs = require("fs");
const profile = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (profile.profile !== "node-v8-libuv-single-thread-http-v1") throw new Error("missing Node HTTP profile");
if (profile.productSupport !== "not-yet-supported") throw new Error(`profile productSupport was ${profile.productSupport}`);
if (profile.implementationLevel !== "not-implemented") throw new Error(`profile implementationLevel was ${profile.implementationLevel}`);
if (profile.migrationCompleted !== false) throw new Error("selected-state harness must not mark migrationCompleted=true");
if (profile.summary?.selectedStateReconstructionHarness !== true) throw new Error("selected-state harness label missing");
if (profile.selectedState?.observedNextCount !== 3 || profile.selectedState?.restoredInitialCount !== 2) throw new Error("selected counter state was not captured from source hits 1 and 2");
' "$WORK/snap/node-level5-runtime-profile.json"

node "$CLI" restore "$WORK/snap" --name "$TARGET" -p "${TARGET_PORT}:3000" --json >"$WORK/restore.json"
node -e '
const fs = require("fs");
const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (summary.productSupport !== "not-yet-supported") throw new Error(`restore productSupport was ${summary.productSupport}`);
if (summary.implementationLevel !== "not-implemented") throw new Error(`unexpected implementationLevel ${summary.implementationLevel}`);
if (summary.migrationCompleted !== false) throw new Error("selected-state harness must not claim migration completion");
if (summary.selectedStateReconstructionHarnessCompleted !== true || summary.notProperLevel5Reason !== "app-specific-selected-state-descriptor") throw new Error("selected-state harness classification missing");
if (summary.targetProof?.targetRuntime !== "node") throw new Error("target runtime was not Node");
if (summary.targetProof?.noSourceIsaEmulation !== true || summary.targetProof?.noSidecarOutput !== true || summary.targetProof?.noMetadataOnlySuccess !== true) throw new Error("restore shortcut gates were not proven false");
if (!Array.isArray(summary.refusals) || summary.refusals.some((row) => row.migrationCompleted !== false || row.productSupport !== "unsupported")) throw new Error("unsafe neighbor refusals are not stable");
' "$WORK/restore.json"

TARGET_THREE="$(curl -fsS "http://127.0.0.1:${TARGET_PORT}/" | tr -d '\r')"
assert_count "$TARGET_THREE" 3

mkdir -p "$WORK/broad-node"
node -e '
const fs = require("fs");
const source = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
delete source.selectedState;
source.sourceGoal = "021";
source.evidenceStatus = "proof";
source.productSupport = "not-yet-supported";
source.implementationLevel = "not-implemented";
source.migrationCompleted = false;
source.summary.productSupportBlockedUntilActualRuntimeStateContinuation = true;
source.summary.selectedStateReconstructionHarness = false;
source.summary.notProperLevel5Reason = "no-selected-state";
fs.writeFileSync(process.argv[2], JSON.stringify(source, null, 2) + "\n");
' "$WORK/snap/node-level5-runtime-profile.json" "$WORK/broad-node/node-level5-runtime-profile.json"
if node "$CLI" restore "$WORK/broad-node" --json >"$WORK/broad-node-restore.json" 2>"$WORK/broad-node-restore.err"; then
  echo "expected broad Node profile restore to be refused" >&2
  exit 1
fi
node -e '
const fs = require("fs");
const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (summary.productSupport !== "not-yet-supported") throw new Error("broad Node product support changed");
if (summary.migrationCompleted !== false) throw new Error("broad Node migration must remain incomplete");
if (summary.refusal?.code !== "node-level5-http-profile-proof-only-not-product") throw new Error("broad Node refusal code changed");
' "$WORK/broad-node-restore.json"

mkdir -p "$WORK/invalid-supported"
node -e '
const fs = require("fs");
const source = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
delete source.selectedState;
source.productSupport = "supported";
source.migrationCompleted = true;
fs.writeFileSync(process.argv[2], JSON.stringify(source, null, 2) + "\n");
' "$WORK/snap/node-level5-runtime-profile.json" "$WORK/invalid-supported/node-level5-runtime-profile.json"
if node "$CLI" restore "$WORK/invalid-supported" --json >"$WORK/invalid-supported-restore.json" 2>"$WORK/invalid-supported-restore.err"; then
  echo "expected productSupport=supported without selected state to be refused" >&2
  exit 1
fi
grep -q "not Level 5 product support" "$WORK/invalid-supported-restore.err"

echo "node HTTP selected-state harness proof smoke passed: $WORK source=${SOURCE_ONE},${SOURCE_TWO} target=${TARGET_THREE}"
