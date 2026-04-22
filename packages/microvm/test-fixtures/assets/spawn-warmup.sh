#!/bin/sh
# Phase 1 of fast-spawn (#50 M1): format /dev/vda, run a Node counter,
# freeze it with CRIU, write the images onto the disk, clean shutdown.
# On the next VMM boot (spawn-restore.sh), we'll bring that frozen
# process back to life and watch the counter keep going.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

say() { printf '\n=== %s ===\n' "$*"; }
show() { printf 'snap/count: '; cat /mnt/snap/count 2>/dev/null || echo '(missing)'; }

# Load the driver chain for virtio-blk.
load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in virtio virtio_ring virtio_mmio virtio_blk \
         sock_diag netlink_diag unix_diag inet_diag tcp_diag udp_diag af_packet_diag \
         tun veth libcrc32c nfnetlink nf_tables; do
    load_ko "$m"
done

# CRIU's kerndat wants a live loopback.
/bin/lo-up

say "format /dev/vda if it isn't already ext4"
if ! blkid /dev/vda 2>/dev/null | grep -q ext4; then
    mkfs.ext4 -F -q /dev/vda
fi
mkdir -p /mnt/snap
mount /dev/vda /mnt/snap || { echo "mount /dev/vda failed"; exit 1; }
rm -rf /mnt/snap/img
mkdir -p /mnt/snap/img

say "launch counter (writes to /mnt/snap/count)"
# Redirect counter output to the persistent mount so we can see
# across boots whether the restored process kept writing.
cat > /tmp/counter-persistent.js <<'JS'
const fs = require('fs');
let n = 0;
setInterval(() => {
  n++;
  fs.writeFileSync('/mnt/snap/count', String(n) + '\n');
}, 1000);
JS
setsid /bin/no-iou /usr/local/bin/node /tmp/counter-persistent.js </dev/null >/dev/null 2>&1 &
PID=$!
echo "counter pid: $PID"
sleep 4
show

say "dump pid=$PID into /mnt/snap/img"
if criu dump --tree "$PID" --images-dir /mnt/snap/img -v3 -o /mnt/snap/img/dump.log; then
    echo "dump OK"
else
    echo "dump FAILED. Tail of dump.log:"
    tail -40 /mnt/snap/img/dump.log
    exit 1
fi
sync

say "unmount + halt"
umount /mnt/snap
sync
# Cooperative shutdown — PSCI SYSTEM_OFF via reboot(RB_POWER_OFF).
python3 - <<'PY'
import ctypes, ctypes.util
libc = ctypes.CDLL(ctypes.util.find_library('c'))
libc.reboot(0x4321fedc)  # LINUX_REBOOT_CMD_POWER_OFF
PY

# Kernel will panic if we return — fine, the VMM sees PSCI_SYSTEM_OFF first.
sleep 3
