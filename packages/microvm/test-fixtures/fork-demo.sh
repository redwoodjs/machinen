#!/bin/sh
# Demo: freeze a running Node counter with CRIU, then restart it from
# the dump. If the counter continues from where it left off rather
# than starting over at 1, CRIU moved the live process state — the
# machinen hot-move primitive, proven.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

say() { printf '\n=== %s ===\n' "$*"; }
show() { printf 'count file: '; cat /tmp/count 2>/dev/null || echo '(missing)'; }

# CRIU's init probes a handful of kernel features before it touches
# our target process. Each of these needs a module loaded in this
# tickless initramfs (no systemd-modules-load, no depmod tree).
load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
# *_diag: needed for CRIU to enumerate open sockets during dump.
for m in sock_diag netlink_diag unix_diag inet_diag tcp_diag udp_diag af_packet_diag; do
    load_ko "$m"
done
# tun: CRIU probes /dev/net/tun. veth: CRIU creates a veth pair as a
# feature check. nf_tables (and its symbol deps): probes nftables_concat.
for m in tun veth libcrc32c nfnetlink nf_tables; do
    load_ko "$m"
done
# /dev/net/tun should come from devtmpfs once tun is loaded, but be
# robust if it doesn't appear (mknod c 10 200).
[ -e /dev/net/tun ] || { mkdir -p /dev/net; mknod /dev/net/tun c 10 200; }

# CRIU's kerndat probe creates a TCP socket and calls connect() against
# loopback. If lo is still DOWN that probe fails with "Network is
# unreachable" and CRIU aborts before it even tries to dump. Bring lo
# up with our tiny ioctl helper (avoids hauling iproute2 into the VM).
/bin/lo-up || echo "warn: lo-up returned $?"

rm -rf /tmp/cpdump /tmp/count
mkdir -p /tmp/cpdump
cd /tmp/cpdump

say "starting counter"
# Run node in a new session so it has no controlling tty — avoids
# CRIU's --shell-job requirement tangling with our serial console.
# /bin/no-iou: seccomp-bpf wrapper that makes io_uring_setup return
# ENOSYS. libuv falls back to epoll. Without this, libuv opens
# io_uring rings (even with UV_USE_IO_URING=0 — that env var is
# ignored by this libuv build) and CRIU can't dump the process.
setsid /bin/no-iou /usr/local/bin/node /counter.js </dev/null >/dev/null 2>&1 &
COUNTER_PID=$!
# Diagnostic: confirm no io_uring fds or mmaps remain.
sleep 2
echo "io_uring fds: $(ls /proc/$COUNTER_PID/fd 2>/dev/null | xargs -I{} readlink /proc/$COUNTER_PID/fd/{} 2>/dev/null | grep -c io_uring || echo ?)"
echo "io_uring mmaps: $(grep -c io_uring /proc/$COUNTER_PID/maps 2>/dev/null || echo ?)"
echo "counter pid: $COUNTER_PID"

sleep 4
show

say "dumping pid=$COUNTER_PID"
# --tree: the process to dump
# --leave-stopped: not used; we want it gone after dump
# -v4 -o: log to file for debugging if this fails
if criu dump --tree "$COUNTER_PID" --images-dir /tmp/cpdump -v4 -o dump.log; then
    echo "dump OK"
else
    rc=$?
    echo "dump FAILED (rc=$rc). Last 60 lines of dump.log:"
    tail -60 /tmp/cpdump/dump.log
    exit 1
fi

say "dumped — process should be gone"
if kill -0 "$COUNTER_PID" 2>/dev/null; then
    echo "WARN: pid $COUNTER_PID still alive after dump"
else
    echo "pid $COUNTER_PID is gone (good)"
fi

sleep 2
say "count file should be frozen"
show

say "restoring"
# -d detaches the restored tree; -v4/-o log for debugging.
if criu restore --images-dir /tmp/cpdump -d -v4 -o restore.log; then
    echo "restore OK"
else
    rc=$?
    echo "restore FAILED (rc=$rc). Last 60 lines of restore.log:"
    tail -60 /tmp/cpdump/restore.log
    exit 1
fi

sleep 4
say "count file after restore"
show

say "if the value above is greater than before the dump, the primitive works"
# Keep the guest alive so output has time to reach the console.
sleep 3
