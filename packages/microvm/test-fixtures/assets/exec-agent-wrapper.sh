#!/bin/sh
# Shell wrapper that loads the vsock kernel modules (they aren't built
# in on the Debian cloud kernel) and execs the static Zig exec-agent
# binary. Staged into the guest rootfs at /sbin/machinen-exec-agent;
# the real binary lives beside it at /sbin/machinen-exec-agent.bin.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH
load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in vsock vmw_vsock_virtio_transport_common virtio virtio_ring virtio_mmio vmw_vsock_virtio_transport; do
    load_ko "$m"
done
exec /sbin/machinen-exec-agent.bin
