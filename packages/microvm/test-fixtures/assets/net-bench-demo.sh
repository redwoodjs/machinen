#!/bin/sh
# Guest side of the #82 libslirp ping-pong smoke.
#
# Opens a TCP connection to a host echo server via slirp's vhost
# address (10.0.2.2), does 100 sequential 1-byte sends + 1-byte
# receives, reports total wall time and μs per round trip. libslirp
# delivers inbound frames on its pump thread (~10 ms cadence by
# default), so every echoed byte stretches the round trip — this
# test is a direct probe of the pump tick.
#
# Prints a machine-parseable line the harness greps for:
#
#   net-bench: pings=<N> total_ms=<int> us_per_ping=<int>
#
# /init has already run /sbin/machinen-netup, so eth0 is up with
# 10.0.2.15/24 and a default route through 10.0.2.2.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

HOST=10.0.2.2
PORT=38080
PINGS=100

# Let the RX queue settle after machinen-netup finished posting buffers.
sleep 1

echo "=== net-bench: tcp://$HOST:$PORT ($PINGS pings) ==="
python3 - "$HOST" "$PORT" "$PINGS" <<'PY' 2>&1
import socket, sys, time
host, port, pings = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
try:
    s = socket.create_connection((host, port), timeout=10)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
except Exception as e:
    print(f"net-bench: error=connect msg={e}")
    sys.exit(0)

try:
    t0 = time.monotonic()
    for i in range(pings):
        s.sendall(b"x")
        buf = s.recv(1)
        if not buf:
            print(f"net-bench: error=eof_at_iter={i}")
            sys.exit(0)
    dt = time.monotonic() - t0
finally:
    s.close()

total_ms = int(dt * 1000)
us_per_ping = int((dt / pings) * 1_000_000)
print(f"net-bench: pings={pings} total_ms={total_ms} us_per_ping={us_per_ping}")
PY

echo "=== done ==="
sleep 1
