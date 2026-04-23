#!/usr/bin/env bash
# #82 libslirp probe. Runs three scenarios through libslirp's vhost
# NAT (10.0.2.2) and prints one line each:
#
#   latency  100x 1-byte ping-pongs   → us_per_ping (pump-tick probe)
#   rx       host → guest bulk (4 MiB) → mb_per_sec
#   tx       guest → host bulk (4 MiB) → mb_per_sec
#
# Each hits a different libslirp path. Informational only — prints
# baselines so #82 tuning has numbers to move against. No asserted
# ceiling; CI doesn't run this (nested virt isn't on hosted runners).
#
# Usage:
#   pnpm bench-net                   # all scenarios x1
#   pnpm bench-net -n 20             # all scenarios x20 (for variance)
#   pnpm bench-net latency           # 100x 1-byte pings only, x1
#   pnpm bench-net -n 50 latency     # 100x 1-byte pings, 50 times
#   pnpm bench-net rx 16777216       # rx only with a 16 MiB size override
#   pnpm bench-net -n 10 rx 1048576  # 10x 1 MiB rx
#
# Multiple iterations run back-to-back inside a single guest boot
# (boot cost is ~8s and only paid once). The shell dumps every raw
# result line and then a per-mode summary: n / min / median / p95 / max.
#
# For direct invocation (not pnpm), run `bash scripts/bench-net.sh [args]`.

set -euo pipefail

ITERATIONS=1
while getopts ":n:" opt; do
  case "$opt" in
    n) ITERATIONS=$OPTARG ;;
    *) echo "usage: bench-net.sh [-n N] [MODE] [SIZE]" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

MODE=${1:-all}
SIZE=${2:-}
case "$MODE" in
  all | latency | rx | tx | rx-par) ;;
  *) echo "bench-net: unknown mode '$MODE' (want: all|latency|rx|tx|rx-par)" >&2; exit 2 ;;
esac
if ! [[ "$ITERATIONS" =~ ^[0-9]+$ ]] || ((ITERATIONS < 1)); then
  echo "bench-net: -n needs a positive integer (got '$ITERATIONS')" >&2
  exit 2
fi

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="$ROOT/packages/cli/dist/cli.js"
VMM="$ROOT/packages/microvm/zig-out/bin/microvm"
ASSETS="$ROOT/release-assets"
BENCH_DIR="$ROOT/scripts/bench-net"
PORT=38080
OS=$(uname -s)

# --- prereqs -------------------------------------------------------

missing=()
for bin in zig; do
  command -v "$bin" >/dev/null || missing+=("$bin")
done
if [[ "$OS" == "Darwin" ]]; then
  found=0
  for p in /opt/homebrew/opt/libslirp/lib/libslirp.0.dylib \
    /usr/local/opt/libslirp/lib/libslirp.0.dylib; do
    [[ -f "$p" ]] && { found=1; break; }
  done
  [[ "$found" -eq 1 ]] || missing+=("libslirp")
fi
if ((${#missing[@]} > 0)); then
  echo "bench-net: missing prerequisites: ${missing[*]}" >&2
  [[ "$OS" == "Darwin" ]] && echo "bench-net: install with: brew install ${missing[*]}" >&2
  exit 1
fi

# --- build ---------------------------------------------------------

echo "=== building VMM ==="
(cd "$ROOT/packages/microvm" && zig build -Doptimize=ReleaseSafe)

if [[ "$OS" == "Darwin" ]]; then
  codesign -s - --force \
    --entitlements "$ROOT/packages/microvm/entitlements.plist" \
    "$VMM" 2>/dev/null
fi

if [[ ! -f "$ASSETS/Image-arm64" ]]; then
  echo "=== building base assets (~5 min first run) ==="
  "$ROOT/scripts/build-base-assets.sh"
fi

if [[ ! -f "$CLI" ]]; then
  echo "=== building @machinen/runtime + @machinen/cli ==="
  pnpm -F @machinen/runtime -F @machinen/cli build >/dev/null
fi

BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"; [[ -n "${ECHO_PID:-}" ]] && kill -9 "$ECHO_PID" 2>/dev/null || true' EXIT

echo "=== building bench-net binaries ==="
# Guest probe — static aarch64-linux-musl; the bundle drops it at
# /usr/bin/bench-net-demo inside the guest.
zig cc -target aarch64-linux-musl -static -Os \
  -o "$BUILD/bench-net-demo" "$BENCH_DIR/bench-net-demo.c"
# Host echo — native, matches the developer machine's arch.
zig cc -O2 \
  -o "$BUILD/bench-net-echo" "$BENCH_DIR/bench-net-echo.c"

# --- host echo + guest run -----------------------------------------

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "bench-net: port $PORT already in use on host" >&2
  exit 1
fi

"$BUILD/bench-net-echo" "$PORT" &
ECHO_PID=$!

# Wait for the echo server to bind.
elapsed=0
while ((elapsed < 10)); do
  if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    break
  fi
  sleep 1
  ((++elapsed))
done
if ((elapsed >= 10)); then
  echo "bench-net: host echo server never bound 127.0.0.1:$PORT" >&2
  exit 1
fi

BUNDLE="$BUILD/bundle"
mkdir -p "$BUNDLE/rootfs/usr/bin"
cp "$BUILD/bench-net-demo" "$BUNDLE/rootfs/usr/bin/bench-net-demo"
chmod +x "$BUNDLE/rootfs/usr/bin/bench-net-demo"

# Compose the guest cmd:
#   ["/usr/bin/bench-net-demo", MODE, SIZE_OR_0, ITERATIONS]
# SIZE is always passed (as "0" when unset) so iterations can land in
# argv[3] — keeps the guest parser simple.
SIZE_ARG=${SIZE:-0}
cat >"$BUNDLE/machinen-config.json" <<JSON
{
  "cmd": ["/usr/bin/bench-net-demo", "$MODE", "$SIZE_ARG", "$ITERATIONS"],
  "env": { "PATH": "/usr/local/bin:/usr/bin:/bin:/sbin" }
}
JSON

echo "=== booting guest (mode=$MODE${SIZE:+ size=$SIZE} iterations=$ITERATIONS) ==="
GUEST_LOG="$BUILD/guest.log"
# Latency: ~1s per iter + 8s boot. Bulk 4 MiB: ~1-5s per iter.
# 30s base + 3s per iter per scenario is a loose upper bound.
# MACHINEN_VMM overrides the CLI's default binary lookup
# (packages/vmm-arm64-darwin/bin/microvm) — we just built it in
# packages/microvm/zig-out/bin/ and don't want to copy it.
case "$MODE" in
  all)     per_iter=9 ;;
  rx-par)  per_iter=0 ;;  # one batch, parallel — sized below
  *)       per_iter=3 ;;
esac
if [[ "$MODE" == "rx-par" ]]; then
  # Aggregate ≈ ITERATIONS * (single-rx wall time). Generous cap.
  TIMEOUT=$((30 + ITERATIONS * 5))
else
  TIMEOUT=$((30 + ITERATIONS * per_iter))
fi
(
  MACHINEN_VMM="$VMM" \
    MACHINEN_ASSETS_DIR="$ASSETS" \
    node "$CLI" run "$BUNDLE" >"$GUEST_LOG" 2>&1
) &
VM_PID=$!

# Wait for the guest's "=== done ===" marker or timeout.
elapsed=0
while ((elapsed < TIMEOUT)) && kill -0 "$VM_PID" 2>/dev/null; do
  if grep -q '^=== done ===' "$GUEST_LOG" 2>/dev/null; then break; fi
  sleep 1
  ((++elapsed))
done
kill -9 "$VM_PID" 2>/dev/null || true
wait "$VM_PID" 2>/dev/null || true

# Pull every `bench-net: ...` result line. Empty == nothing ran.
lines=$(grep '^bench-net: ' "$GUEST_LOG" || true)
if [[ -z "$lines" ]]; then
  echo "bench-net: guest never reported results (log below)" >&2
  tail -40 "$GUEST_LOG" >&2
  exit 1
fi

echo
# Optional per-second slirp instrumentation for #82. Harmless when absent.
slirp_lines=$(grep '^\[slirp\]' "$GUEST_LOG" || true)
if [[ -n "$slirp_lines" ]]; then
  echo "--- slirp instrumentation ---"
  echo "$slirp_lines"
  echo
fi
echo "--- raw samples ---"
echo "$lines"

# --- summary ------------------------------------------------------
# For each mode actually present in the results, pull the primary
# metric column (us_per_ping for latency, mb_per_sec for rx/tx),
# sort numerically, and print n / min / median / p95 / max.
summarize() {
  local mode=$1 col=$2
  local values
  # Match ` mode=<name> ` exactly so `rx` doesn't match `rx-par`.
  values=$(echo "$lines" | awk -v m=" mode=$mode " -v c="$col=" '
    index($0, m) > 0 {
      for (i = 1; i <= NF; i++) {
        if ($i ~ "^"c) { split($i, a, "="); print a[2]; break }
      }
    }')
  [[ -z "$values" ]] && return
  # LC_ALL=C so awk prints 144.5 (period), not 144,5 under locales that use comma as the decimal mark.
  echo "$values" | sort -n | LC_ALL=C awk -v mode="$mode" -v col="$col" '
    { a[NR] = $1 }
    END {
      n = NR
      min = a[1]; max = a[n]
      med = (n % 2) ? a[int((n + 1) / 2)] : (a[n/2] + a[n/2 + 1]) / 2
      p95_idx = int(n * 0.95 + 0.5); if (p95_idx < 1) p95_idx = 1; if (p95_idx > n) p95_idx = n
      p95 = a[p95_idx]
      printf "bench-net: summary mode=%s metric=%s n=%d min=%s median=%s p95=%s max=%s\n", \
        mode, col, n, min, med, p95, max
    }'
}

echo
echo "--- summary ---"
summarize latency us_per_ping
summarize rx      mb_per_sec
summarize tx      mb_per_sec
