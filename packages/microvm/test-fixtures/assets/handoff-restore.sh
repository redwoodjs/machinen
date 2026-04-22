#!/bin/sh
# Restores the CRIU dump that handoff-dump.sh produced on another host.
# Expects the images at /workspace (packed in via a second cpio in the
# initramfs stream; see the orchestrator for how that's built).
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

say() { printf '\n=== %s ===\n' "$*"; }
show() { printf '/tmp/count: '; cat /tmp/count 2>/dev/null || echo '(missing)'; }

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

say "images handed over at /workspace"
ls /workspace | head

say "criu restore"
if criu-ns restore --images-dir /workspace -d -v3 -o /tmp/restore.log; then
    echo "restore OK"
else
    echo "restore FAILED. Tail of restore.log:"; tail -40 /tmp/restore.log; exit 1
fi

say "watching /tmp/count for advancement"
for i in 1 2 3 4 5; do
    sleep 1
    show
done

say "done"
sleep 2
