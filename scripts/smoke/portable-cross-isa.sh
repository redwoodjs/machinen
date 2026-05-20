#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PROXMOX_SSH=${PORTABLE_AMD64_SSH:-root@192.168.0.8}
PROXMOX_CT=${PORTABLE_AMD64_PROXMOX_CT:-111}
DOCKER_IMAGE=${PORTABLE_AMD64_DOCKER_IMAGE:-node:22-bookworm}

if ! command -v cc >/dev/null 2>&1; then
  echo "portable-cross-isa: skip — host cc not found"
  exit 0
fi

if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$PROXMOX_SSH" 'true' >/dev/null 2>&1; then
  echo "portable-cross-isa: skip — cannot reach $PROXMOX_SSH"
  exit 0
fi

if ! ssh "$PROXMOX_SSH" "pct exec '$PROXMOX_CT' -- docker version >/dev/null 2>&1"; then
  echo "portable-cross-isa: skip — Proxmox CT $PROXMOX_CT has no Docker"
  exit 0
fi

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK/work/packages/microvm/assets" "$WORK/work/scripts"
cc -Wall -Wextra -pthread -I "$ROOT/packages/microvm/assets" \
  "$ROOT/packages/microvm/assets/portable-proof-workload.c" \
  -o "$WORK/portable-proof-arm64"

echo "portable-resource-marker" >"$WORK/resource.txt"
"$WORK/portable-proof-arm64" \
  --threads \
  --nested-continuation \
  --restore-proof \
  --resource-file "$WORK/resource.txt" \
  --emit-bundle "$WORK/work/bundle" \
  >"$WORK/work/source.log"

cp "$ROOT/packages/microvm/assets/portable-checkpoint-abi.h" \
   "$ROOT/packages/microvm/assets/portable-proof-workload.c" \
   "$WORK/work/packages/microvm/assets/"
cp "$ROOT/scripts/portable-proof-compare.mjs" "$WORK/work/scripts/"
cp "$WORK/resource.txt" "$WORK/work/resource.txt"

tar --no-xattrs -czf - -C "$WORK/work" . |
  ssh "$PROXMOX_SSH" \
    "pct exec '$PROXMOX_CT' -- bash -lc 'rm -rf /tmp/machinen-portable-cross && mkdir -p /tmp/machinen-portable-cross && tar -xzf - -C /tmp/machinen-portable-cross'"

ssh "$PROXMOX_SSH" "pct exec '$PROXMOX_CT' -- docker run --rm -i -v /tmp/machinen-portable-cross:/work -w /work '$DOCKER_IMAGE' bash -s" <<'REMOTE'
set -euo pipefail
gcc -Wall -Wextra -pthread -I packages/microvm/assets \
  packages/microvm/assets/portable-proof-workload.c \
  -o /tmp/machinen-portable-proof-amd64
# The arm64 source bundle records the host temp path for the regular-file
# resource. Rewrite it to the path available inside this amd64 target container.
python3 - <<'PY'
from pathlib import Path
p = Path('/work/bundle/resources.json')
s = p.read_text()
start = s.index('"id":"file-1"')
path_key = '"path":"'
path_start = s.index(path_key, start) + len(path_key)
path_end = s.index('"', path_start)
s = s[:path_start] + '/work/resource.txt' + s[path_end:]
p.write_text(s)
PY
/tmp/machinen-portable-proof-amd64 --restore-bundle /work/bundle >/tmp/target.log
cat /work/source.log /tmp/target.log >/tmp/combined.log
node scripts/portable-proof-compare.mjs \
  --require-restore \
  --require-continue \
  --require-threads \
  --require-nested-continuation \
  --bundle-dir /work/bundle \
  /tmp/combined.log
REMOTE

echo "portable-cross-isa: pass — arm64 bundle restored in amd64 proof process"
