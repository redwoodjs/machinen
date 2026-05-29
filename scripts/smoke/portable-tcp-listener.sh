#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
if [[ -n "${WORK_DIR:-}" ]]; then
  WORK="$WORK_DIR"
else
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-tcp-listener.XXXXXX")"
fi
NAME="portable-tcp-listener-$$"
mkdir -p "$WORK"

if [[ ! -f "$CLI" ]]; then
  echo "missing built CLI: $CLI (run pnpm build first)" >&2
  exit 1
fi

cleanup() {
  node "$CLI" stop "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

host_arch=$(node -e 'const a=process.arch; console.log(a === "arm64" ? "arm64" : a === "x64" ? "amd64" : a)')
source_arch="arm64"
if [[ "$host_arch" == "arm64" ]]; then
  source_arch="amd64"
fi

printf 'tcp-listener family=inet protocol=tcp bind=127.0.0.1:18080 backlog=16 acceptQueue=empty reuseaddr=true\n' \
  >"$WORK/source.verify"

node "$CLI" capture tcp-listener \
  --out "$WORK/bundle" \
  --source-arch "$source_arch" \
  --target-arch "$host_arch" \
  --source-verifier-output "$WORK/source.verify" \
  --bind-address 127.0.0.1 \
  --port 18080 \
  --backlog 16 \
  --json >"$WORK/capture.json"

node -e 'const fs=require("fs"); const descriptor=JSON.parse(fs.readFileSync(`${process.argv[1]}/portable-tcp-listener.json`,"utf8")); if (descriptor.subset !== "tcp-listener-v1-loopback-empty-accept-queue") throw new Error("wrong subset"); if (descriptor.implementationLevel !== "level-4-kernel-resource-reconstruction") throw new Error("wrong level"); if (descriptor.listener.bindAddress !== "127.0.0.1" || descriptor.listener.port !== 18080 || descriptor.listener.backlog !== 16 || descriptor.listener.acceptQueue !== "empty") throw new Error("wrong listener descriptor");' \
  "$WORK/bundle"

node "$CLI" restore "$WORK/bundle" \
  --target-arch "$host_arch" \
  --target-verifier-output "$WORK/source.verify" \
  --name "$NAME" \
  --json >"$WORK/restore.json"

node -e 'const fs=require("fs"); const restore=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (restore.state !== "completed" || restore.migrationCompleted !== true || restore.implementationLevel !== "level-4-kernel-resource-reconstruction" || !restore.restoredName || !restore.restoredPid || !restore.targetOutputObserved || restore.continuationSemantics.port !== 18080 || restore.continuationSemantics.acceptQueue !== "empty") throw new Error("portable TCP listener restore did not start target VM continuation");' \
  "$WORK/restore.json"

node "$CLI" exec "$NAME" -- \
  'grep -q "MACHINEN_TCP_LISTENER_RESTORED family=inet protocol=tcp bind=127.0.0.1:18080 backlog=16" /tmp/machinen-restored-tcp-listener.log && test -d /proc/$(cat /tmp/machinen-restored-tcp-listener.pid)'

echo "portable TCP listener smoke passed: $WORK"
