#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
if [[ -n "${WORK_DIR:-}" ]]; then
  WORK="$WORK_DIR"
else
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-timerfd.XXXXXX")"
fi
NAME="portable-timerfd-$$"
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

printf 'timerfd clock=monotonic mode=relative remainingMs=60000 intervalMs=0 expirations=0 flags=cloexec\n' \
  >"$WORK/source.verify"

node "$CLI" capture timerfd \
  --out "$WORK/bundle" \
  --source-arch "$source_arch" \
  --target-arch "$host_arch" \
  --source-verifier-output "$WORK/source.verify" \
  --remaining-ms 60000 \
  --json >"$WORK/capture.json"

node -e 'const fs=require("fs"); const descriptor=JSON.parse(fs.readFileSync(`${process.argv[1]}/portable-timerfd.json`,"utf8")); if (descriptor.subset !== "timerfd-relative-oneshot-v1-monotonic") throw new Error("wrong subset"); if (descriptor.implementationLevel !== "level-4-kernel-resource-reconstruction") throw new Error("wrong level"); if (descriptor.timerfd.clock !== "monotonic" || descriptor.timerfd.remainingMs !== 60000 || descriptor.timerfd.intervalMs !== 0) throw new Error("wrong timerfd descriptor");' \
  "$WORK/bundle"

node "$CLI" restore "$WORK/bundle" \
  --target-arch "$host_arch" \
  --target-verifier-output "$WORK/source.verify" \
  --name "$NAME" \
  --json >"$WORK/restore.json"

node -e 'const fs=require("fs"); const restore=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (restore.state !== "completed" || restore.migrationCompleted !== true || restore.implementationLevel !== "level-4-kernel-resource-reconstruction" || !restore.restoredName || !restore.restoredPid || !restore.targetOutputObserved || restore.continuationSemantics.remainingMs !== 60000) throw new Error("portable timerfd restore did not start target VM continuation");' \
  "$WORK/restore.json"

node "$CLI" exec "$NAME" -- \
  'grep -q "MACHINEN_TIMERFD_RESTORED clock=monotonic mode=relative remainingMs=60000" /tmp/machinen-restored-timerfd.log && test -d /proc/$(cat /tmp/machinen-restored-timerfd.pid)'

echo "portable timerfd smoke passed: $WORK"
