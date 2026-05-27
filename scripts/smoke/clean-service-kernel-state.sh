#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-clean-service-kernel-state.XXXXXX")}"
SAFE="clean-service-kernel-safe-$$"
UNSAFE="clean-service-kernel-unsafe-$$"
mkdir -p "$WORK"

cleanup() {
  node "$CLI" stop "$SAFE" >/dev/null 2>&1 || true
  node "$CLI" stop "$UNSAFE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export MACHINEN_ASSETS_DIR="${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}"
export MACHINEN_REGISTRY_DIR="$WORK/registry"

boot_node_service() {
  local name=$1 mode=$2
  node "$CLI" boot --name "$name" --detach -- sleep 100000 >/dev/null
  node "$CLI" exec "$name" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null"
  node "$CLI" exec "$name" -- "mkdir -p /opt/machinen-clean-service-kernel && cat >/opt/machinen-clean-service-kernel/server.js <<'JS'
const fs = require('node:fs');
const http = require('node:http');
const mode = process.argv[2];
fs.writeFileSync('/opt/machinen-clean-service-kernel/config.txt', 'safe-config');
global.safeFd = fs.openSync('/opt/machinen-clean-service-kernel/config.txt', 'r');
if (mode === 'deleted-open-file') {
  fs.writeFileSync('/tmp/machinen-clean-service-deleted.txt', 'unsafe');
  global.deletedFd = fs.openSync('/tmp/machinen-clean-service-deleted.txt', 'r');
  fs.unlinkSync('/tmp/machinen-clean-service-deleted.txt');
}
http.createServer((_req, res) => res.end('machinen-clean-service-kernel-state-v1')).listen(3000, '127.0.0.1');
JS
cd /opt/machinen-clean-service-kernel && nohup node server.js '$mode' >/tmp/clean-service-kernel-$mode.log 2>&1 &"
  node "$CLI" exec "$name" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/clean-service-kernel-$mode.log; exit 1"
}

boot_node_service "$SAFE" safe
node "$CLI" snapshot "$SAFE" "$WORK/safe-snap" --json >"$WORK/safe-snapshot.json"
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const k=m.components[0].kernelResources; if (!k || k.summary.supported < 1 || !k.supported.includes("clean-service-app-root-fd-captured")) throw new Error("safe app-root fd was not recorded as supported");' "$WORK/safe-snap/portable-clean-service.json"

boot_node_service "$UNSAFE" deleted-open-file
if node "$CLI" snapshot "$UNSAFE" "$WORK/unsafe-snap" --json >"$WORK/unsafe-snapshot.json" 2>"$WORK/unsafe-snapshot.err"; then
  echo "expected deleted-open-file kernel-state refusal" >&2
  exit 1
fi
grep -q "clean-service-deleted-open-file-unsupported" "$WORK/unsafe-snapshot.err"

echo "clean-service kernel-state support/refusal smoke passed: $WORK"
