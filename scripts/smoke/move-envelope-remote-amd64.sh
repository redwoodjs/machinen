#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${MACHINEN_MOVE_REMOTE_HOST:-root@192.168.0.8}"
REMOTE_DIR="${MACHINEN_MOVE_REMOTE_DIR:-/mnt/shared-500G/machinen-move-proof}"
PLAN="${MACHINEN_MOVE_REMOTE_PLAN:-scripts/smoke/move-envelope-framework-plan.json}"
REMOTE_OUT="${MACHINEN_MOVE_REMOTE_OUT:-/tmp/machinen-move-framework-remote}"
DRY_RUN=0

usage() {
  echo "usage: $0 [--host user@host] [--remote-dir path] [--plan plan.json] [--remote-out dir] [--dry-run]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      REMOTE_HOST="${2:-}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="${2:-}"
      shift 2
      ;;
    --plan)
      PLAN="${2:-}"
      shift 2
      ;;
    --remote-out)
      REMOTE_OUT="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ ! -f "$PLAN" ]]; then
  echo "missing chunk plan: $PLAN" >&2
  exit 2
fi

CHUNKS=()
while IFS= read -r chunk; do
  CHUNKS+=("$chunk")
done < <(python3 - "$PLAN" <<'PY'
import json, sys
for chunk in json.load(open(sys.argv[1])).get('chunks', []):
    print(chunk['name'])
PY
)

if [[ "${#CHUNKS[@]}" == "0" ]]; then
  echo "chunk plan has no chunks: $PLAN" >&2
  exit 2
fi

if [[ "$DRY_RUN" == "1" ]]; then
  printf 'remote=%s\nremoteDir=%s\nplan=%s\nremoteOut=%s\nchunks=%s\n' "$REMOTE_HOST" "$REMOTE_DIR" "$PLAN" "$REMOTE_OUT" "${CHUNKS[*]}"
  exit 0
fi

rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude packages/*/node_modules \
  --exclude packages/*/dist \
  --exclude .zig-cache \
  ./ "$REMOTE_HOST:$REMOTE_DIR/"

ssh "$REMOTE_HOST" "set -euo pipefail
cd '$REMOTE_DIR'
mkdir -p '$REMOTE_OUT'
rm -f '$REMOTE_OUT'/*.json
export MACHINEN_VMM=\"\$PWD/packages/microvm/zig-out/bin/machinen-vm\"
export MACHINEN_GVPROXY=\"\$PWD/packages/native-x64-linux/vmm/bin/gvproxy\"
if ! file \"\$MACHINEN_GVPROXY\" | grep -qi 'ELF'; then
  echo \"MACHINEN_GVPROXY is not a Linux ELF binary: \$MACHINEN_GVPROXY\" >&2
  exit 2
fi
find /tmp -maxdepth 1 -name 'machinen-move-matrix-*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
pnpm install --frozen-lockfile
pnpm -F @machinen/cli build
node packages/cli/dist/cli.js boot --name move-remote-probe-\$\$ --detach --json -- sleep infinity >/tmp/machinen-remote-probe.json
node packages/cli/dist/cli.js exec move-remote-probe-\$\$ -- uname -m | tee '$REMOTE_OUT/uname.txt'
node packages/cli/dist/cli.js stop move-remote-probe-\$\$ >/dev/null 2>&1 || true
for chunk in ${CHUNKS[*]}; do
  echo \"running remote move envelope chunk: \$chunk\" >&2
  pnpm proof-move-envelope-matrix -- --json --timings --chunk-plan '$PLAN' --chunk \"\$chunk\" | tee '$REMOTE_OUT'/\"\$chunk\".json
done
pnpm proof-move-envelope-matrix -- --json --chunk-plan '$PLAN' --coverage-dir '$REMOTE_OUT' | tee '$REMOTE_OUT'/coverage.json
"

ssh "$REMOTE_HOST" "cat '$REMOTE_OUT'/coverage.json"
