#!/bin/sh
# Dumps a Node counter with CRIU, writes the dump as a cpio stream to
# /dev/vda (no filesystem — the host just reads it back with `cpio -id`).
# Pairs with handoff-restore.sh which runs on the other host.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

say() { printf '\n=== %s ===\n' "$*"; }

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in virtio virtio_ring virtio_mmio virtio_blk \
         sock_diag netlink_diag unix_diag inet_diag tcp_diag udp_diag af_packet_diag \
         tun veth libcrc32c nfnetlink nf_tables; do
    load_ko "$m"
done
[ -e /dev/net/tun ] || { mkdir -p /dev/net; mknod /dev/net/tun c 10 200; }
/bin/lo-up || echo "warn: lo-up returned $?"

rm -rf /tmp/cpdump && mkdir -p /tmp/cpdump

say "starting counter"
setsid /bin/no-iou /usr/local/bin/node /counter.js </dev/null >/dev/null 2>&1 &
COUNTER_PID=$!
sleep 4
printf 'counter at: '; cat /tmp/count 2>/dev/null || echo '(missing)'

say "dumping pid=$COUNTER_PID"
if criu dump --tree "$COUNTER_PID" --images-dir /tmp/cpdump -v3 -o /tmp/cpdump/dump.log; then
    echo "dump OK"
else
    echo "dump FAILED. Tail of dump.log:"; tail -40 /tmp/cpdump/dump.log; exit 1
fi

say "writing cpio stream of /tmp/cpdump to /dev/vda"
cd /tmp/cpdump || exit 1
find . | cpio -H newc -o > /dev/vda 2>/dev/null
sync
echo "cpio write done"

say "power off"
python3 - <<'PY'
import ctypes, ctypes.util
libc = ctypes.CDLL(ctypes.util.find_library('c'))
libc.reboot(0x4321fedc)  # LINUX_REBOOT_CMD_POWER_OFF
PY
sleep 3
