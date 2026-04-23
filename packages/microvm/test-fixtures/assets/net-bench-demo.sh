#!/bin/sh
# Guest side of the #82 gvproxy ping-pong smoke.
#
# Runs /sbin/machinen-net-bench-probe, a static musl binary that
# connects to a host echo server reachable through gvproxy's built-in
# host mapping (192.168.127.254, which gvproxy proxies to the host's
# loopback), does 100 sequential 1-byte sends + receives, and prints:
#
#   net-bench: pings=<N> total_ms=<int> us_per_ping=<int>
#
# /init has already run /sbin/machinen-netup, so eth0 is up with
# 192.168.127.2/24 and a default route through 192.168.127.1.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

HOST=192.168.127.254
PORT=38080
PINGS=100

# Let the RX queue settle after machinen-netup finished posting buffers.
sleep 1

echo "=== net-bench: tcp://$HOST:$PORT ($PINGS pings) ==="
/sbin/machinen-net-bench-probe "$HOST" "$PORT" "$PINGS"

echo "=== done ==="
sleep 1
