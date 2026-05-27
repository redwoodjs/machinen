#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-go-clean-service.XXXXXX")}"
NAME="go-clean-service-$$"
RESTORED="go-clean-service-restored-$$"
mkdir -p "$WORK"

cleanup() {
  node "$CLI" stop "$NAME" >/dev/null 2>&1 || true
  node "$CLI" stop "$RESTORED" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export MACHINEN_ASSETS_DIR="${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}"
export MACHINEN_REGISTRY_DIR="$WORK/registry"

flip_source_arch() {
  node -e 'const fs=require("fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); m.sourceArch = m.sourceArch === "arm64" ? "amd64" : "arm64"; fs.writeFileSync(p, JSON.stringify(m, null, 2)+"\n");' "$1"
}
make_portable_only_bundle() {
  mkdir -p "$1"
  cp "$WORK/snap/portable-clean-service.json" "$1/portable-clean-service.json"
  cp "$WORK/snap/clean-service-go-primary.tar.gz" "$1/clean-service-go-primary.tar.gz"
}

node "$CLI" boot --name "$NAME" --detach -- sleep 100000 >/dev/null
node "$CLI" exec "$NAME" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends golang-go curl ca-certificates file binutils >/dev/null"
node "$CLI" exec "$NAME" -- "mkdir -p /opt/machinen-go-clean-service && cat >/opt/machinen-go-clean-service/server.go <<'GO'
package main
import (
  \"fmt\"
  \"net/http\"
)
func main() {
  http.HandleFunc(\"/\", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, \"machinen-go-clean-service-v1\") })
  if err := http.ListenAndServe(\"127.0.0.1:3000\", nil); err != nil { panic(err) }
}
GO
cd /opt/machinen-go-clean-service && CGO_ENABLED=0 go build -o server ./server.go && nohup ./server >/tmp/go-clean-service.log 2>&1 &"
node "$CLI" exec "$NAME" -- "for i in \$(seq 1 80); do curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1 && exit 0; sleep 0.25; done; cat /tmp/go-clean-service.log; exit 1"

node "$CLI" snapshot "$NAME" "$WORK/snap" --json >"$WORK/snapshot.json"
test -f "$WORK/snap/portable-clean-service.json"
test -f "$WORK/snap/clean-service-go-primary.tar.gz"
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (m.components[0].subset !== "go-http-clean-root-v1" || m.components[0].runtimePolicy.compatibility !== "none-static-binary") throw new Error("Go clean-service manifest missing static runtime policy");' "$WORK/snap/portable-clean-service.json"

make_portable_only_bundle "$WORK/restore"
flip_source_arch "$WORK/restore/portable-clean-service.json"
node "$CLI" restore "$WORK/restore" --name "$RESTORED" --json >"$WORK/restore.json"
node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (s.migrationCompleted !== true || s.targetVerifierResult !== "passed") throw new Error("portable Go clean-service restore did not complete");' "$WORK/restore.json"

echo "go clean-service snapshot/restore smoke passed: $WORK"
