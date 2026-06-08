#!/usr/bin/env bash
# Cross-arch proof harness for `machinen move` ping continuation.
#
# This is intentionally a proof/audit script, not part of the default product
# smoke suite: it needs a native x86_64 host reachable over ssh for the amd64
# target VM. Default values match the maintainer lab host used during the move
# implementation work.
#
# Required/overridable env:
#   MACHINEN_MOVE_PROOF_REMOTE=root@192.168.0.8
#   MACHINEN_MOVE_PROOF_REMOTE_REPO=/mnt/shared-500G/machinen-move-proof
#   MACHINEN_MOVE_PROOF_REMOTE_ASSETS_DIR=$REMOTE_REPO/release-assets
#
# Optional:
#   MACHINEN_MOVE_PROOF_JSON=1 or --json
#   MACHINEN_MOVE_PROOF_BUILD_REMOTE=1   # rebuild remote CLI/VMM/assets first
#   MACHINEN_MOVE_PROOF_KEEP=1           # keep VMs/temp dirs for debugging

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
REMOTE=${MACHINEN_MOVE_PROOF_REMOTE:-root@192.168.0.8}
REMOTE_REPO=${MACHINEN_MOVE_PROOF_REMOTE_REPO:-/mnt/shared-500G/machinen-move-proof}
REMOTE_ASSETS_DIR=${MACHINEN_MOVE_PROOF_REMOTE_ASSETS_DIR:-${REMOTE_REPO}/release-assets}
JSON=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON=1 ;;
    --) ;;
    "") ;;
    *) echo "usage: $0 [--json]" >&2; exit 64 ;;
  esac
done
if [ "${MACHINEN_MOVE_PROOF_JSON:-}" = "1" ]; then
  JSON=1
fi
RUN_ID="move-ping-cross-arch-$$-$(date +%s)"
SRC_VM="${MACHINEN_MOVE_PROOF_SOURCE_VM:-${RUN_ID}-src}"
TGT_VM="${MACHINEN_MOVE_PROOF_TARGET_VM:-${RUN_ID}-tgt}"
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/machinen-move-ping-cross-arch.XXXXXX")
BUNDLE="$WORKDIR/bundle"
SAVE_JSON="$WORKDIR/save.json"
REMOTE_WORKDIR="/mnt/shared-500G/${RUN_ID}"
REMOTE_BUNDLE="${REMOTE_WORKDIR}/bundle"
REMOTE_LOAD_JSON="${REMOTE_WORKDIR}/load.json"
REMOTE_LOG_TXT="${REMOTE_WORKDIR}/target.log"

q() { printf '%q' "$1"; }

info() {
  if [ "$JSON" != "1" ]; then
    echo "$*" >&2
  fi
}

remote_bash() {
  local body="$1"
  local script="set -euo pipefail; cd $(q "$REMOTE_REPO"); export TMPDIR=/mnt/shared-500G/tmp XDG_CACHE_HOME=/mnt/shared-500G/cache PNPM_HOME=/mnt/shared-500G/pnpm-home MACHINEN_GUEST_ARCH=amd64 MACHINEN_ASSETS_DIR=$(q "$REMOTE_ASSETS_DIR"); ${body}"
  ssh "$REMOTE" "bash -lc $(q "$script")"
}

local_cli() {
  (cd "$ROOT" && MACHINEN_GUEST_ARCH=arm64 MACHINEN_ASSETS_DIR="$ROOT/release-assets" node packages/cli/dist/cli.js "$@")
}

cleanup() {
  if [ "${MACHINEN_MOVE_PROOF_KEEP:-}" = "1" ]; then
    info "keep requested: source=$SRC_VM target=$TGT_VM workdir=$WORKDIR remote_workdir=$REMOTE_WORKDIR"
    return
  fi
  (cd "$ROOT" && MACHINEN_GUEST_ARCH=arm64 MACHINEN_ASSETS_DIR="$ROOT/release-assets" node packages/cli/dist/cli.js stop "$SRC_VM" >/dev/null 2>&1 || true)
  remote_bash "node packages/cli/dist/cli.js stop $(q "$TGT_VM") >/dev/null 2>&1 || true; rm -rf $(q "$REMOTE_WORKDIR")" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

info "==> building local runtime/cli"
(cd "$ROOT" && pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null)

if [ "${MACHINEN_MOVE_PROOF_BUILD_REMOTE:-}" = "1" ]; then
  info "==> building remote runtime/cli/VMM/assets on $REMOTE"
  remote_bash "pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null; bash scripts/build-vmm.sh >/dev/null; MACHINEN_GUEST_ARCH=amd64 bash scripts/build-base-assets.sh >/dev/null"
fi

info "==> booting source arm64 VM: $SRC_VM"
local_cli boot --name "$SRC_VM" --detach --json -- sleep infinity >/dev/null
info "==> booting target amd64 VM on $REMOTE: $TGT_VM"
remote_bash "mkdir -p $(q "$REMOTE_WORKDIR"); node packages/cli/dist/cli.js boot --name $(q "$TGT_VM") --detach --json -- sleep infinity > $(q "$REMOTE_WORKDIR/target.boot.json")"

info "==> starting source distro ping"
SOURCE_PID=$(local_cli exec "$SRC_VM" -- "ping google.com > /tmp/ping.log 2>&1 & echo \$!" | tail -1 | tr -d '\r')
if ! [[ "$SOURCE_PID" =~ ^[0-9]+$ ]]; then
  echo "move-ping-cross-arch: failed to parse source ping pid: $SOURCE_PID" >&2
  exit 1
fi
sleep 5

info "==> saving source ping pid=$SOURCE_PID"
mkdir -p "$BUNDLE"
set +e
local_cli move save "$SRC_VM" "$SOURCE_PID" "$BUNDLE" --json > "$SAVE_JSON"
SAVE_RC=$?
set -e
if [ ! -f "$BUNDLE/move.json" ]; then
  echo "move-ping-cross-arch: move save did not write $BUNDLE/move.json (rc=$SAVE_RC)" >&2
  exit 1
fi

SOURCE_STATE_JSON=$(node -e 'const d=require(process.argv[1]); console.log(JSON.stringify(d.resourcePlan.capture.pingState));' "$BUNDLE/move.json")
SOURCE_N=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.ntransmitted);' "$SOURCE_STATE_JSON")
EXPECTED_NEXT=$(( SOURCE_N + 1 ))
info "==> source ping state: $SOURCE_STATE_JSON (expect target first seq $EXPECTED_NEXT)"

info "==> copying bundle to target host"
ssh "$REMOTE" "mkdir -p $(q "$REMOTE_BUNDLE")"
rsync -az --delete "$BUNDLE/" "$REMOTE:${REMOTE_BUNDLE}/"

info "==> loading into amd64 target"
remote_bash "node packages/cli/dist/cli.js move load $(q "$TGT_VM") $(q "$REMOTE_BUNDLE") --json > $(q "$REMOTE_LOAD_JSON")"

LOAD_SUMMARY=$(remote_bash "node - <<'NODE'
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.env.REMOTE_LOAD_JSON || '$REMOTE_LOAD_JSON', 'utf8'));
const loader = j.loader || j.rendezvous;
console.log(JSON.stringify({
  accepted: j.accepted,
  strategy: loader?.strategy,
  targetPid: loader?.targetPid,
  logPath: loader?.logPath,
  patchState: loader?.patch?.state,
  sourceArch: j.targetValidation?.source?.architecture,
  targetArch: j.targetValidation?.target?.architecture,
  patchRows: String(loader?.patch?.stdout || '').split('\n').filter((row) => row.startsWith('PATCH\t') || row.startsWith('SAFE_BOUNDARY\t')),
}));
NODE")

ACCEPTED=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.accepted ? "1" : "0");' "$LOAD_SUMMARY")
TARGET_PID=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.targetPid || "");' "$LOAD_SUMMARY")
TARGET_LOG=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.logPath || "");' "$LOAD_SUMMARY")
STRATEGY=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.strategy || "");' "$LOAD_SUMMARY")
PATCH_STATE=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.patchState || "");' "$LOAD_SUMMARY")

if [ "$ACCEPTED" != "1" ] || [ "$STRATEGY" != "target-original-ping-direct-loader" ] || [ "$PATCH_STATE" != "ready" ]; then
  echo "move-ping-cross-arch: load did not reach ready direct-loader state: $LOAD_SUMMARY" >&2
  exit 1
fi
if ! [[ "$TARGET_PID" =~ ^[0-9]+$ ]] || [ -z "$TARGET_LOG" ]; then
  echo "move-ping-cross-arch: load summary missing target pid/log: $LOAD_SUMMARY" >&2
  exit 1
fi

info "==> collecting target continuation log"
sleep 5
remote_bash "node packages/cli/dist/cli.js exec $(q "$TGT_VM") -- $(q "kill -INT $TARGET_PID; sleep 1; cat $TARGET_LOG") > $(q "$REMOTE_LOG_TXT")"
TARGET_OUTPUT=$(ssh "$REMOTE" "cat $(q "$REMOTE_LOG_TXT")")

VERIFY_JSON=$(printf '%s' "$TARGET_OUTPUT" | node -e '
const fs = require("fs");
const input = fs.readFileSync(0, "utf8");
const expected = Number(process.argv[1]);
const seqs = [...input.matchAll(/icmp_seq=(\d+)/g)].map((m) => Number(m[1]));
const summary = input.match(/(\d+) packets transmitted, (\d+) received/);
const markerIndex = input.indexOf("MACHINEN_MOVE_RESUME");
const firstSeq = seqs[0];
const ok = markerIndex >= 0 && firstSeq === expected && !seqs.includes(1) && summary && Number(summary[1]) >= expected && Number(summary[2]) >= expected;
console.log(JSON.stringify({ ok, marker: markerIndex >= 0, firstSeq, expectedFirstSeq: expected, seqs: seqs.slice(0, 8), transmitted: summary ? Number(summary[1]) : null, received: summary ? Number(summary[2]) : null }));
process.exit(ok ? 0 : 1);
' "$EXPECTED_NEXT")

if [ "$JSON" = "1" ]; then
  node - <<NODE
const summary = $LOAD_SUMMARY;
const verify = $VERIFY_JSON;
const sourceState = $SOURCE_STATE_JSON;
console.log(JSON.stringify({
  kind: 'machinen.move-ping-cross-arch-proof',
  state: 'passed',
  source: { arch: 'arm64', vm: '$SRC_VM', pid: Number('$SOURCE_PID'), pingState: sourceState },
  target: { arch: 'amd64', remote: '$REMOTE', vm: '$TGT_VM', pid: summary.targetPid, logPath: summary.logPath },
  loader: summary,
  continuation: verify,
}, null, 2));
NODE
else
  echo "pass: move ping arm64→amd64 direct-loader continuation"
  echo "  source: pid=$SOURCE_PID state=$SOURCE_STATE_JSON"
  echo "  loader: $LOAD_SUMMARY"
  echo "  continuation: $VERIFY_JSON"
fi
