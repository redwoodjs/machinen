#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-ping.XXXXXX")}"
NAME="portable-ping-$$"
mkdir -p "$WORK"

if [[ ! -f "$CLI" ]]; then
  echo "missing built CLI: $CLI (run pnpm build first)" >&2
  exit 1
fi

cleanup() {
  node "$CLI" stop "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

node "$CLI" boot --detach --name "$NAME" -- sleep 1000 >"$WORK/boot.json"
node "$CLI" exec "$NAME" -- 'ping -i 10 127.0.0.1 >/tmp/machinen-ping.log 2>&1 & echo $! >/tmp/machinen-ping.pid'
sleep 2

MACHINEN_SNAPSHOT_ENGINE=portable \
  node "$CLI" snapshot "$NAME" "$WORK/bundle" --json >"$WORK/snapshot.json"

node -e 'const fs=require("fs"); const descriptor=JSON.parse(fs.readFileSync(`${process.argv[1]}/portable-ping-socket.json`,"utf8")); if (descriptor.subset !== "ping-level4-socket-reconstruction-v1") throw new Error("wrong subset"); if (descriptor.implementationLevel !== "level-4-kernel-resource-reconstruction") throw new Error("wrong level"); fs.writeFileSync(process.argv[2], `${descriptor.sourceVerifierOutput}\n`); fs.writeFileSync(process.argv[3], `${descriptor.target.architecture}\n`);' \
  "$WORK/bundle" "$WORK/target.verify" "$WORK/target.arch"

host_arch=$(node -e 'const a=process.arch; console.log(a === "arm64" ? "arm64" : a === "x64" ? "amd64" : a)')
target_arch=$(cat "$WORK/target.arch")
if [[ "$host_arch" != "$target_arch" && "${MACHINEN_PORTABLE_PING_REQUIRE_TARGET_RESTORE:-0}" != "1" ]]; then
  echo "portable ping machine snapshot passed; target restore skipped on $host_arch host for $target_arch bundle: $WORK"
  exit 0
fi

node "$CLI" restore "$WORK/bundle" \
  --target-arch "$target_arch" \
  --target-verifier-output "$WORK/target.verify" \
  --json >"$WORK/restore.json"

node -e 'const fs=require("fs"); const snap=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const restore=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); if (!snap.snap_dir) throw new Error("snapshot did not return snap_dir"); if (restore.state !== "completed" || restore.migrationCompleted !== true || restore.implementationLevel !== "level-4-kernel-resource-reconstruction" || !restore.restoredName || !restore.restoredPid || !restore.targetOutputObserved) throw new Error("portable ping restore did not start target VM continuation");' \
  "$WORK/snapshot.json" "$WORK/restore.json"

echo "portable ping machine smoke passed: $WORK"
