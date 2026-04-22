#!/bin/sh
# Phase 2 of fast-spawn (#50 M1): mount /dev/vda (carrying the CRIU
# images from spawn-warmup.sh), bring the frozen process back to
# life, and report that the counter kept going from where phase 1
# left it.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

say() { printf '\n=== %s ===\n' "$*"; }
show() { printf 'snap/count: '; cat /mnt/snap/count 2>/dev/null || echo '(missing)'; }

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in virtio virtio_ring virtio_mmio virtio_blk \
         sock_diag netlink_diag unix_diag inet_diag tcp_diag udp_diag af_packet_diag \
         tun veth libcrc32c nfnetlink nf_tables; do
    load_ko "$m"
done
/bin/lo-up

say "mount /dev/vda"
mkdir -p /mnt/snap
mount /dev/vda /mnt/snap || { echo "mount /dev/vda failed"; exit 1; }

say "snapshot as handed over from warmup"
show
ls /mnt/snap/img | head

say "criu restore (via criu-ns for a fresh PID namespace)"
# CRIU restores processes into their original PIDs; in the fresh VM
# the init chain has consumed a bunch of them. criu-ns is a helper
# shipped with CRIU that sets up a new PID namespace with a long-
# lived init inside, then runs `criu restore` there. The restored
# process becomes a child of that init so it sticks around after
# detach.
HEAD_PID=$(ls /mnt/snap/img/core-*.img 2>/dev/null | head -1 | sed 's/.*core-\([0-9]*\)\.img/\1/')
echo "head PID in dump: $HEAD_PID"

if criu-ns restore --images-dir /mnt/snap/img -d -v3 -o /mnt/snap/img/restore.log; then
    echo "restore OK"
else
    echo "restore FAILED. Tail of restore.log:"
    tail -40 /mnt/snap/img/restore.log
    exit 1
fi

say "watching /mnt/snap/count for advancement"
for i in 1 2 3 4 5; do
    sleep 1
    show
done

say "done"
sleep 2
