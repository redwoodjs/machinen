#!/usr/bin/env bash
# Shared harness for vmstate-focused smoke repros.
# Source this file from timers.sh / entropy.sh / sockets.sh, then call
# vmstate_smoke_init before running area-specific tests.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"
VMM="$ROOT/packages/native-arm64-darwin/vmm/bin/machinen-vm"
ASSETS="$ROOT/release-assets"
OS=$(uname -s)

FIXTURE=""
HELPERS_DIR=""
CLEANUP_PIDS=()
CLEANUP_NAMES=()

pass() { echo "  pass: $1"; }
fail() { echo "  FAIL: $1" >&2; exit 1; }
section() { echo; echo "=== $1 ==="; }

register_pid() {
  CLEANUP_PIDS+=("$1")
}

register_vm_name() {
  CLEANUP_NAMES+=("$1")
}

cleanup_vmstate_smoke() {
  local name pid
  for name in "${CLEANUP_NAMES[@]:-}"; do
    node "$CLI" stop "$name" --force >/dev/null 2>&1 || true
  done
  for pid in "${CLEANUP_PIDS[@]:-}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 0.2 || true
  for pid in "${CLEANUP_PIDS[@]:-}"; do
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [[ -n "$FIXTURE" ]]; then
    rm -rf "$FIXTURE"
  fi
}

run_timeout() {
  local secs=$1
  shift
  "$@" &
  local pid=$!
  (sleep "$secs" && kill -TERM "$pid" 2>/dev/null && sleep 2 && kill -KILL "$pid" 2>/dev/null) &
  local watcher=$!
  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return "$rc"
}

vmstate_smoke_init() {
  local label=${1:-vmstate}
  FIXTURE=$(mktemp -d "${TMPDIR:-/tmp}/machinen-$label.XXXXXX")
  HELPERS_DIR="$FIXTURE/helpers"
  mkdir -p "$HELPERS_DIR"
  trap cleanup_vmstate_smoke EXIT

  missing=()
  for bin in zig docker dtc; do
    command -v "$bin" >/dev/null || missing+=("$bin")
  done
  if ((${#missing[@]} > 0)); then
    echo "smoke-vmstate: missing prerequisites: ${missing[*]}" >&2
    if [[ "$OS" == "Darwin" ]]; then
      echo "smoke-vmstate: install with: brew install ${missing[*]}" >&2
    fi
    exit 1
  fi

  if [[ ! -f "$ASSETS/Image-arm64" ]]; then
    if ! docker info >/dev/null 2>&1; then
      echo "smoke-vmstate: Docker is not running (needed to build release-assets/)" >&2
      echo "smoke-vmstate: start Docker Desktop and re-run" >&2
      exit 1
    fi
  fi

  echo "=== building VMM ==="
  bash "$ROOT/scripts/build-vmm.sh"

  if [[ ! -f "$ASSETS/Image-arm64" ]]; then
    echo "=== building base assets (~5 min on first run, cached after) ==="
    "$ROOT/scripts/build-base-assets.sh"
  fi

  if ! "$ROOT/scripts/check-asset-freshness.sh" --quiet; then
    echo "smoke-vmstate: release-assets/ is stale — rebuild with bash $ROOT/scripts/build-base-assets.sh" >&2
    exit 1
  fi

  echo "=== building @machinen/runtime + @machinen/cli ==="
  pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null

  "$ROOT/scripts/install-gvproxy.sh" --dest "$(dirname "$VMM")"

  echo "=== building guest vmstate helpers ==="
  build_guest_helper vmstate-timer-probe
  build_guest_helper vmstate-entropy-probe
  build_guest_helper vmstate-socket-probe

  export MACHINEN_VMM="$VMM"
  export MACHINEN_ASSETS_DIR="$ASSETS"
  export MACHINEN_SNAPSHOT_ENGINE=vmstate
  export MACHINEN_REGISTRY_DIR="$FIXTURE/registry"
  mkdir -p "$MACHINEN_REGISTRY_DIR"

  echo
  echo "smoke-vmstate: VMM=$MACHINEN_VMM"
  echo "smoke-vmstate: ASSETS=$MACHINEN_ASSETS_DIR"
  echo "smoke-vmstate: REGISTRY=$MACHINEN_REGISTRY_DIR"
  echo
}

build_guest_helper() {
  local name=$1
  local src="$ROOT/packages/microvm/test-fixtures/assets/$name.c"
  local out="$HELPERS_DIR/$name"
  zig cc -target aarch64-linux-musl -static -O2 -Wall -Wextra -o "$out" "$src"
  chmod +x "$out"
}

cli() {
  node "$CLI" "$@"
}

boot_bg() {
  local name=$1
  local log=$2
  shift 2
  node "$CLI" boot --name "$name" "$@" >"$log" 2>&1 &
  local pid=$!
  register_pid "$pid"
  register_vm_name "$name"
  echo "$pid"
}

restore_bg() {
  local log=$1
  shift
  node "$CLI" restore "$@" >"$log" 2>&1 &
  local pid=$!
  register_pid "$pid"
  echo "$pid"
}

fork_detached() {
  local source=$1
  local new_name=$2
  local log=$3
  shift 3
  if ! cli fork "$source" --new-name "$new_name" --detach "$@" >"$log" 2>&1; then
    cat "$log" >&2
    fail "fork $source -> $new_name failed"
  fi
  register_vm_name "$new_name"
}

wait_for_vm() {
  local name=$1
  local timeout=${2:-45}
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if cli ls 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$name"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

find_restore_child() {
  local src=$1
  cli ls 2>/dev/null | awk -v slash="$src/" -v tilde="$src~" \
    'NR>1 && (index($2, slash)==1 || index($2, tilde)==1) {print $2; exit}'
}

wait_for_restore_child() {
  local src=$1
  local out_var=$2
  local timeout=${3:-60}
  local deadline=$((SECONDS + timeout))
  local cand=""
  while (( SECONDS < deadline )); do
    cand=$(find_restore_child "$src")
    if [[ -n "$cand" ]]; then
      printf -v "$out_var" '%s' "$cand"
      register_vm_name "$cand"
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_log() {
  local log=$1
  local needle=$2
  local timeout=${3:-60}
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if grep -q -- "$needle" "$log" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_reseed() {
  local name=$1
  local timeout=${2:-30}
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if cli exec "$name" -- test -s /run/machinen-vmstate-reseed >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

snapshot_vm() {
  local name=$1
  local out=$2
  local log=$3
  if ! cli snapshot "$name" "$out" >"$log" 2>&1; then
    cat "$log" >&2
    fail "snapshot $name failed"
  fi
  if [[ ! -f "$out/state.vmstate" || ! -f "$out/meta.json" ]]; then
    ls -la "$out" >&2 || true
    fail "snapshot $name did not produce a vmstate bundle"
  fi
}

pick_port() {
  node - <<'NODE'
const net = require('node:net');
const srv = net.createServer();
srv.listen(0, '127.0.0.1', () => {
  const addr = srv.address();
  console.log(addr.port);
  srv.close();
});
NODE
}

tcp_exchange() {
  local port=$1
  local payload=${2:-ping}
  local timeout_ms=${3:-8000}
  node - "$port" "$payload" "$timeout_ms" <<'NODE'
const net = require('node:net');
const [portRaw, payload, timeoutRaw] = process.argv.slice(2);
const port = Number(portRaw);
const timeoutMs = Number(timeoutRaw);
let done = false;
const sock = net.createConnection({ host: '127.0.0.1', port });
const chunks = [];
const timer = setTimeout(() => finish(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
function finish(err) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  sock.destroy();
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.stdout.write(Buffer.concat(chunks).toString('utf8'));
}
sock.on('connect', () => sock.write(`${payload}\n`));
sock.on('data', (chunk) => {
  chunks.push(chunk);
  if (Buffer.concat(chunks).includes(0x0a)) finish();
});
sock.on('error', finish);
sock.on('end', () => finish(chunks.length ? undefined : new Error('connection ended without data')));
NODE
}

assert_no_tcp_connect() {
  local port=$1
  if tcp_exchange "$port" probe 1500 >/dev/null 2>&1; then
    fail "unexpectedly connected to 127.0.0.1:$port"
  fi
}

start_host_echo_server() {
  local port=$1
  local log=$2
  local server_js="$FIXTURE/host-echo-server.js"
  if [[ ! -f "$server_js" ]]; then
    cat >"$server_js" <<'NODE'
const net = require('node:net');
const port = Number(process.argv[2]);
const srv = net.createServer((sock) => {
  sock.on('data', (chunk) => {
    sock.write(`ack:${chunk.length}\n`);
  });
});
srv.listen(port, '127.0.0.1', () => {
  console.log(`HOST_ECHO_READY port=${port}`);
});
NODE
  fi
  local pidfile="$FIXTURE/host-echo-server.pid"
  (
    node "$server_js" "$port" >"$log" 2>&1 &
    echo $! >"$pidfile"
  )
  local pid
  pid=$(cat "$pidfile")
  register_pid "$pid"
  if ! wait_log "$log" "HOST_ECHO_READY" 10; then
    cat "$log" >&2 || true
    fail "host echo server did not start on $port"
  fi
  echo "$pid"
}

json_ports_for_name() {
  local name=$1
  cli ls --json | node -e '
const fs = require("node:fs");
const name = process.argv[1];
const parsed = JSON.parse(fs.readFileSync(0, "utf8"));
const rows = Array.isArray(parsed) ? parsed : (parsed.vms ?? []);
const row = rows.find((r) => r.name === name);
if (!row) process.exit(2);
process.stdout.write(JSON.stringify(row.ports ?? []));
' "$name"
}
