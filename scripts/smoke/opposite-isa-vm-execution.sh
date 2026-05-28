#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-opposite-isa.XXXXXX")}"
JSON=0
LIVE=${OPPOSITE_ISA_VM_LIVE:-0}
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --live) LIVE=1; shift ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/opposite-isa-vm-execution.sh [--json] [--live] [--work-dir path]" >&2; exit 2 ;;
  esac
done

host_arch=$(node -e 'const a=process.arch; process.stdout.write(a === "x64" ? "amd64" : a === "arm64" ? "arm64" : "unknown")')
case "$host_arch" in
  arm64) guest_arch=amd64 ;;
  amd64) guest_arch=arm64 ;;
  *) guest_arch=unknown ;;
esac

route_summary="$WORK/opposite-route.json"
if [[ "$LIVE" = 1 ]]; then
  pnpm exec tsx "$ROOT/scripts/opposite-isa-vm-execution.ts" \
    --guest-arch "$guest_arch" \
    --live \
    --summary "$route_summary" \
    --json >"$WORK/opposite-route.stdout"
else
  pnpm exec tsx "$ROOT/scripts/opposite-isa-vm-execution.ts" \
    --guest-arch "$guest_arch" \
    --summary "$route_summary" \
    --json >"$WORK/opposite-route.stdout"
fi

node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.kind !== "machinen.architecture-portable-snapshot.opposite-isa-vm-execution") throw new Error("wrong summary kind"); if (s.hostArch === s.guestArch) throw new Error("route was not opposite ISA"); if (!["completed","skipped"].includes(s.state)) throw new Error(`unexpected route state ${s.state}`); if (s.state === "completed" && (!s.guestUnameMachine || !s.guestElfMachine || !s.kernelVersion || !s.rootfsDigest)) throw new Error("completed route missing guest evidence"); if (s.state === "skipped" && (!s.refusalCode || !s.remediation)) throw new Error("skipped route missing stable refusal/remediation");' "$route_summary"

negative_summary="$WORK/host-sidecar-negative.json"
if pnpm exec tsx "$ROOT/scripts/opposite-isa-vm-execution.ts" \
  --guest-arch "$guest_arch" \
  --fixture host-sidecar \
  --summary "$negative_summary" \
  --json >"$WORK/host-sidecar-negative.stdout"; then
  echo "host-sidecar fixture unexpectedly passed" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.state !== "refused" || s.refusalCode !== "opposite-isa-host-sidecar-output") throw new Error("host-sidecar output was not refused");' "$negative_summary"

completed_fixture="$WORK/completed-fixture.json"
pnpm exec tsx "$ROOT/scripts/opposite-isa-vm-execution.ts" \
  --guest-arch "$guest_arch" \
  --fixture completed \
  --summary "$completed_fixture" \
  --json >"$WORK/completed-fixture.stdout"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.state !== "completed" || !s.emulated || s.verifierOutput.includes("host-sidecar")) throw new Error("completed guest fixture did not prove guest execution shape");' "$completed_fixture"

node --input-type=module - "$WORK" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const work = process.argv[2];
const route = JSON.parse(readFileSync(`${work}/opposite-route.json`, 'utf8'));
const hostSidecar = JSON.parse(readFileSync(`${work}/host-sidecar-negative.json`, 'utf8'));
const fixture = JSON.parse(readFileSync(`${work}/completed-fixture.json`, 'utf8'));
const summary = {
  kind: 'machinen.architecture-portable-snapshot.opposite-isa-vm-execution-smoke',
  state: route.state === 'refused' ? 'failed' : 'completed',
  liveRequested: process.env.OPPOSITE_ISA_VM_LIVE === '1',
  route,
  negativeProof: hostSidecar,
  completedFixture: fixture,
};
writeFileSync(`${work}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('opposite-isa-vm-execution smoke: '+s.state+' route='+s.route.state+' '+s.route.hostArch+'->'+s.route.guestArch+' work=$WORK')"
fi
