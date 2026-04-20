#!/bin/sh
# Guest side of the #57 file-agent smoke.
#
# Loads the vsock kernel modules and execs file-agent.py, which
# binds AF_VSOCK port 1976 and loops accepting PUSH/PULL connections
# from the host.

PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}

for m in vsock vmw_vsock_virtio_transport_common virtio virtio_ring virtio_mmio vmw_vsock_virtio_transport; do
    load_ko "$m"
done

if [ ! -c /dev/vsock ]; then
    echo "file-agent-demo: /dev/vsock missing"
    exit 1
fi

exec python3 /file-agent.py
