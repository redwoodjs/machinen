#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-product.XXXXXX")}"
NAME="node-product-$$"
RESTORED="node-product-restored-$$"
mkdir -p "$WORK"

cleanup() {
  node "$CLI" stop "$NAME" >/dev/null 2>&1 || true
  node "$CLI" stop "$RESTORED" >/dev/null 2>&1 || true
  node "$CLI" stop "$RESTORED-verifier" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export MACHINEN_ASSETS_DIR="${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}"
export MACHINEN_REGISTRY_DIR="$WORK/registry"

node "$CLI" boot --name "$NAME" --detach -- sleep 100000 >/dev/null
node "$CLI" exec "$NAME" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null"
node "$CLI" exec "$NAME" -- "mkdir -p /opt/machinen-node-product && cat >/opt/machinen-node-product/server.js <<'JS'
const http = require('node:http');
const server = http.createServer((_req, res) => res.end('machinen-node-product-v1'));
server.listen(3000, '127.0.0.1');
JS
cd /opt/machinen-node-product && nohup node server.js >/tmp/node-product.log 2>&1 &"
node "$CLI" exec "$NAME" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/node-product.log; exit 1"

node "$CLI" snapshot "$NAME" "$WORK/snap" --json >"$WORK/snapshot.json"
test -f "$WORK/snap/portable-clean-service.json"
test -f "$WORK/snap/clean-service-node-primary.tar.gz"
test -f "$WORK/snap/portable-node.json"
test -f "$WORK/snap/portable-node-app.tar.gz"

flip_source_arch() {
  node -e 'const fs=require("fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); m.sourceArch = m.sourceArch === "arm64" ? "amd64" : "arm64"; fs.writeFileSync(p, JSON.stringify(m, null, 2)+"\n");' "$1"
}
set_source_arch() {
  node -e 'const fs=require("fs"); const p=process.argv[1]; const arch=process.argv[2]; const m=JSON.parse(fs.readFileSync(p,"utf8")); m.sourceArch = arch; fs.writeFileSync(p, JSON.stringify(m, null, 2)+"\n");' "$1" "$2"
}
make_portable_only_bundle() {
  mkdir -p "$1"
  cp "$WORK/snap/portable-clean-service.json" "$1/portable-clean-service.json"
  cp "$WORK/snap/clean-service-node-primary.tar.gz" "$1/clean-service-node-primary.tar.gz"
}

make_portable_only_bundle "$WORK/arch-mismatch"
set_source_arch "$WORK/arch-mismatch/portable-clean-service.json" "$(node -p 'process.arch === "arm64" ? "arm64" : "amd64"')"
if node "$CLI" restore "$WORK/arch-mismatch" --json >"$WORK/arch-mismatch.json" 2>"$WORK/arch-mismatch.err"; then
  echo "expected target architecture mismatch refusal" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.migrationCompleted !== false || s.refusal?.code !== "clean-service-target-architecture-mismatch") throw new Error("target architecture mismatch refusal missing");' "$WORK/arch-mismatch.json"

make_portable_only_bundle "$WORK/digest-tamper"
flip_source_arch "$WORK/digest-tamper/portable-clean-service.json"
node -e 'const fs=require("fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); m.components[0].artifact.sha256 = "0".repeat(64); fs.writeFileSync(p, JSON.stringify(m, null, 2)+"\n");' "$WORK/digest-tamper/portable-clean-service.json"
if node "$CLI" restore "$WORK/digest-tamper" --json >"$WORK/digest-tamper.json" 2>"$WORK/digest-tamper.err"; then
  echo "expected descriptor digest tamper refusal" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.migrationCompleted !== false || s.refusal?.code !== "clean-service-artifact-digest-mismatch") throw new Error("digest tamper refusal missing");' "$WORK/digest-tamper.json"

make_portable_only_bundle "$WORK/verifier-mismatch"
flip_source_arch "$WORK/verifier-mismatch/portable-clean-service.json"
node -e 'const fs=require("fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); m.components[0].verifier.sha256 = "1".repeat(64); fs.writeFileSync(p, JSON.stringify(m, null, 2)+"\n");' "$WORK/verifier-mismatch/portable-clean-service.json"
if node "$CLI" restore "$WORK/verifier-mismatch" --name "$RESTORED-verifier" --json >"$WORK/verifier-mismatch.json" 2>"$WORK/verifier-mismatch.err"; then
  echo "expected verifier mismatch refusal" >&2
  exit 1
fi
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.migrationCompleted !== false || s.refusal?.code !== "clean-service-verifier-mismatch") throw new Error("verifier mismatch refusal missing");' "$WORK/verifier-mismatch.json"
node "$CLI" stop "$RESTORED-verifier" >/dev/null 2>&1 || true

make_portable_only_bundle "$WORK/restore"
flip_source_arch "$WORK/restore/portable-clean-service.json"
node "$CLI" restore "$WORK/restore" --name "$RESTORED" --json >"$WORK/restore.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.migrationCompleted !== true || s.targetVerifierResult !== "passed") throw new Error("portable node restore did not complete");' "$WORK/restore.json"

node "$CLI" exec "$NAME" -- "for p in /proc/[0-9]*; do [ -r \"\$p/cmdline\" ] || continue; c=\$(tr '\\0' ' ' <\"\$p/cmdline\"); case \"\$c\" in node*server.js*) kill \"\${p#/proc/}\" || true;; esac; done; cat >/opt/machinen-node-product/hold.js <<'JS'
const http = require('node:http');
http.createServer((req, res) => { if (req.url === '/hold') return; res.end('ok'); }).listen(3000, '127.0.0.1');
JS
cd /opt/machinen-node-product && nohup node hold.js >/tmp/node-product-hold.log 2>&1 &"
node "$CLI" exec "$NAME" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/node-product-hold.log; exit 1"
node "$CLI" exec "$NAME" -- "curl -fsS http://127.0.0.1:3000/hold >/tmp/node-product-hold-client.log 2>&1 &"
if node "$CLI" snapshot "$NAME" "$WORK/active-tcp-snap" 2>"$WORK/active-tcp-snapshot.err"; then
  echo "expected unsafe Node active TCP snapshot refusal" >&2
  exit 1
fi
grep -q "clean-service-active-session-unsupported" "$WORK/active-tcp-snapshot.err"

node "$CLI" exec "$NAME" -- "for p in /proc/[0-9]*; do [ -r \"\$p/cmdline\" ] || continue; c=\$(tr '\\0' ' ' <\"\$p/cmdline\"); case \"\$c\" in node*hold.js*) kill \"\${p#/proc/}\" || true;; esac; done; cd /opt/machinen-node-product && nohup node --inspect=127.0.0.1:9229 server.js >/tmp/node-product-inspect.log 2>&1 &"
node "$CLI" exec "$NAME" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/node-product-inspect.log; exit 1"
if node "$CLI" snapshot "$NAME" "$WORK/unsafe-snap" 2>"$WORK/unsafe-snapshot.err"; then
  echo "expected unsafe Node inspector snapshot refusal" >&2
  exit 1
fi
grep -q "node-inspector-session-unsupported" "$WORK/unsafe-snapshot.err"

echo "node product snapshot/restore smoke passed: $WORK"
