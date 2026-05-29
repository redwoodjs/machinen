#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
if [[ -n "${WORK_DIR:-}" ]]; then
  WORK="$WORK_DIR"
else
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-pipe.XXXXXX")"
fi
NAME="portable-pipe-$$"
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

printf 'pipe readFd=10 writeFd=12 buffer=empty peer=open waiters=none readiness=not-readable flags=cloexec\n' \
  >"$WORK/source.verify"

node "$CLI" capture pipe \
  --out "$WORK/bundle" \
  --source-arch "$source_arch" \
  --target-arch "$host_arch" \
  --source-verifier-output "$WORK/source.verify" \
  --read-fd 10 \
  --write-fd 12 \
  --json >"$WORK/capture.json"

node -e 'const fs=require("fs"); const descriptor=JSON.parse(fs.readFileSync(`${process.argv[1]}/portable-pipe.json`,"utf8")); if (descriptor.subset !== "pipe-pair-v1-empty-no-waiters") throw new Error("wrong subset"); if (descriptor.implementationLevel !== "level-4-kernel-resource-reconstruction") throw new Error("wrong level"); if (descriptor.pipe.readFd !== 10 || descriptor.pipe.writeFd !== 12 || descriptor.pipe.buffer !== "empty" || descriptor.pipe.waiters !== "none") throw new Error("wrong pipe descriptor");' \
  "$WORK/bundle"

node "$CLI" restore "$WORK/bundle" \
  --target-arch "$host_arch" \
  --target-verifier-output "$WORK/source.verify" \
  --name "$NAME" \
  --json >"$WORK/restore.json"

node -e 'const fs=require("fs"); const restore=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (restore.state !== "completed" || restore.migrationCompleted !== true || restore.implementationLevel !== "level-4-kernel-resource-reconstruction" || !restore.restoredName || !restore.restoredPid || !restore.targetOutputObserved || restore.continuationSemantics.buffer !== "empty") throw new Error("portable pipe restore did not start target VM continuation");' \
  "$WORK/restore.json"

node "$CLI" exec "$NAME" -- \
  'grep -q "MACHINEN_PIPE_RESTORED readFd=10 writeFd=12" /tmp/machinen-restored-pipe.log && test -d /proc/$(cat /tmp/machinen-restored-pipe.pid)'

echo "portable pipe smoke passed: $WORK"
