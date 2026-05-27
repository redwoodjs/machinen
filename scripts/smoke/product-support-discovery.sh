#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-product-support.XXXXXX")}"
mkdir -p "$WORK"

if [[ ! -f "$CLI" ]]; then
  echo "missing built CLI: $CLI (run pnpm build first)" >&2
  exit 1
fi

check_family() {
  local family="$1"
  local out="$WORK/$family.json"
  node "$CLI" support --family "$family" --json >"$out"
  node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (data.count <= 0) throw new Error(`empty family ${data.filters.family}`); if (!data.entries.every((entry)=>entry.family===data.filters.family)) throw new Error(`family filter mismatch ${data.filters.family}`);' "$out"
}

check_family nodejs
check_family go
check_family python-ruby-jvm
check_family stateful-services
check_family foundation-native
check_family native-linux-resource
check_family network-ping-socket

node "$CLI" support --family network-ping-socket --profile ping-socket-known-unread-reply-v3-multiple-replies-refusal --json >"$WORK/ping.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const entry=data.entries[0]; if (!entry || entry.productStatus !== "stable-product-refusal" || entry.migrationCompleted !== false || !entry.productRefusalCode) throw new Error("ping refusal not product-visible");' "$WORK/ping.json"

node "$CLI" support --profile postgres-clean-quiesced-cross-arch-logical-restore --json >"$WORK/postgres.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const entry=data.entries[0]; if (!entry || entry.productStatus === "implemented-product-support" || entry.migrationCompleted !== false) throw new Error("postgres should not be advertised as implemented snapshot/restore support");' "$WORK/postgres.json"

node "$CLI" support --profile node-app-http-server-recreate --json >"$WORK/node-implemented.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const entry=data.entries[0]; if (!entry || entry.productStatus !== "implemented-product-support" || entry.migrationCompleted !== true) throw new Error("node product support not visible");' "$WORK/node-implemented.json"

node "$CLI" support --profile python-cross-arch-runtime-policy --json >"$WORK/python-implemented.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const entry=data.entries[0]; if (!entry || entry.productStatus !== "implemented-product-support" || entry.migrationCompleted !== true) throw new Error("python product support not visible");' "$WORK/python-implemented.json"
node "$CLI" support --profile go-cross-arch-runtime-policy --json >"$WORK/go-implemented.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const entry=data.entries[0]; if (!entry || entry.productStatus !== "implemented-product-support" || entry.migrationCompleted !== true) throw new Error("go product support not visible");' "$WORK/go-implemented.json"

node "$CLI" support --status proof-only-fixture --json >"$WORK/proof-only.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (data.count <= 0) throw new Error("no proof-only entries"); if (!data.entries.every((entry)=>entry.migrationCompleted === false && entry.proofOnly === true)) throw new Error("proof-only entry surfaced as support");' "$WORK/proof-only.json"

node "$ROOT/scripts/product-claim-registry-matrix.mjs" --summary "$WORK/product-claim-registry-matrix.json"

echo "product support discovery smoke passed: $WORK"
