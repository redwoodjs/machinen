#!/bin/sh
# CRIU freeze/restore demo, pipe-free.

set -e

echo ""
echo "=== machinen-microvm CRIU freeze/restore demo ==="
echo ""

mkdir -p /logs /dump

# CRIU needs a handful of netlink-diag kernel modules to probe
# socket state. They're in /lib/modules on the rootfs (we added
# the kernel package to the Docker image for this).
echo ">>> loading kernel modules CRIU needs"
for m in sock_diag unix_diag netlink_diag packet_diag tcp_diag udp_diag inet_diag; do
    /usr/sbin/modprobe "$m" 2>/dev/null && echo "    ok: $m" || echo "    skip: $m"
done

# Tiny ticker — prints every 500 ms so we can see state survive a
# dump/restore cycle.
cat > /ticker.js <<'JS'
let tick = 0;
const started = Date.now();
console.log(`[ticker] started pid=${process.pid}`);
setInterval(() => {
  tick++;
  console.log(`[ticker] tick=${tick} elapsed=${Date.now() - started}ms pid=${process.pid}`);
}, 500);
JS

echo ">>> starting ticker in background"
setsid /usr/local/bin/node /ticker.js > /logs/ticker.log 2>&1 < /dev/null &
TICKER_PID=$!
echo "    ticker pid: $TICKER_PID"

# Give it time to tick a few times.
sleep 2

echo ""
echo ">>> ticker output before freeze:"
cat /logs/ticker.log

echo ""
echo ">>> freezing ticker with CRIU..."
set +e
/usr/sbin/criu dump -t "$TICKER_PID" -D /dump --shell-job -o dump.log
DUMP_RC=$?
set -e
if [ "$DUMP_RC" -eq 0 ]; then
    echo "    dump ok"
    ls /dump
    echo "    tail of dump.log:"
    tail -5 /dump/dump.log
else
    echo "    dump FAILED (rc=$DUMP_RC)"
    tail -20 /dump/dump.log
    sleep 999999
fi

echo ""
echo ">>> restoring from dump..."
set +e
/usr/sbin/criu restore -D /dump --shell-job --restore-detached -o restore.log
RESTORE_RC=$?
set -e
if [ "$RESTORE_RC" -eq 0 ]; then
    echo "    restore ok"
    sleep 2
    echo ""
    echo ">>> ticker output after restore (should show continued counter):"
    cat /logs/ticker.log
else
    echo "    restore FAILED (rc=$RESTORE_RC)"
    tail -20 /dump/restore.log
fi

echo ""
echo "=== demo complete ==="
sleep 999999
