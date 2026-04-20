#!/bin/sh
# Guest side of the #51 winsize smoke.
#
# Loads the vsock kernel modules and starts the TIOCSWINSZ agent. The
# host talks to it through the UDS the vsock bridge listens on (set
# via MACHINEN_VSOCK=in:1974:<path>).

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
    echo "winsize-demo: /dev/vsock missing; transport didn't bind"
    dmesg 2>/dev/null | grep -Ei "vsock|virtio" | tail -20
    exit 1
fi

echo "winsize-demo: boot done; starting agent"
exec python3 /winsize-agent.py
