#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-level5-vm-detected.XXXXXX")}"
NAME="node-level5-detected-$$"
mkdir -p "$WORK"

cleanup() {
  node "$CLI" stop "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export MACHINEN_ASSETS_DIR="${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}"
export MACHINEN_REGISTRY_DIR="$WORK/registry"

node "$CLI" boot --name "$NAME" --detach -- sleep 100000 >/dev/null
node "$CLI" exec "$NAME" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null"
node "$CLI" exec "$NAME" -- "mkdir -p /opt/machinen-node-level5-detected && cat >/opt/machinen-node-level5-detected/package.json <<'JSON'
{\"name\":\"machinen-node-level5-detected\",\"version\":\"1.0.0\"}
JSON
cat >/opt/machinen-node-level5-detected/server.js <<'JS'
const http = require('node:http');
const server = http.createServer((_req, res) => res.end('machinen-node-level5-detected-v1'));
server.listen(3000, '127.0.0.1');
JS
cd /opt/machinen-node-level5-detected && nohup node server.js >/tmp/node-level5-detected.log 2>&1 &"
node "$CLI" exec "$NAME" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/node-level5-detected.log; exit 1"

node "$CLI" snapshot "$NAME" --out "$WORK/snap" --json >"$WORK/snapshot.json"
node -e 'const fs=require("fs"); const path=require("path"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.dry_run !== false || path.resolve(s.snap_dir) !== path.resolve(process.argv[2])) throw new Error("generic --out snapshot json did not report expected snap_dir");' "$WORK/snapshot.json" "$WORK/snap"

test -f "$WORK/snap/portable-node.json"
test -f "$WORK/snap/portable-node-app.tar.gz"
test -f "$WORK/snap/portable-clean-service.json"
test -f "$WORK/snap/clean-service-node-primary.tar.gz"
node -e 'const fs=require("fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); if (m.runtime !== "node" || m.subset !== "node-http-clean-root-v1" || m.sourceCwd !== "/opt/machinen-node-level5-detected") throw new Error("generic VM snapshot did not retain detected Node workload");' "$WORK/snap/portable-node.json"

echo "node level5 VM-detected generic snapshot smoke passed: $WORK"
