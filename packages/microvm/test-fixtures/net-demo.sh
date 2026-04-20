#!/bin/sh
# Sanity check the virtio-MMIO device we stand up in the VMM.
#
# Loads the kernel modules needed to probe it, then dumps what the
# guest can see: interfaces via /sys/class/net, virtio bus contents
# via /sys/bus/virtio/devices, and relevant kernel log lines via
# /dev/kmsg. Meant to be executed from demo.sh.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}

# virtio.ko is the core; virtio_ring is the virtqueue layer;
# virtio_mmio is the bus driver that probes our DTS nodes;
# failover + net_failover are deps of virtio_net;
# virtio_net is the device-type driver that binds to device ID 1.
for m in virtio virtio_ring virtio_mmio failover net_failover virtio_net; do
    load_ko "$m"
done

# Give the kernel a beat to probe.
sleep 1

echo
echo "=== net interfaces ==="
ls /sys/class/net 2>/dev/null || echo "(no /sys/class/net)"

echo
echo "=== virtio bus devices ==="
if [ -d /sys/bus/virtio/devices ]; then
    for d in /sys/bus/virtio/devices/*; do
        [ -e "$d" ] || continue
        device_id=$(cat "$d/device" 2>/dev/null)
        vendor_id=$(cat "$d/vendor" 2>/dev/null)
        echo "$(basename "$d") device=$device_id vendor=$vendor_id"
    done
fi

echo
echo "=== virtio kernel log lines ==="
dmesg 2>/dev/null | grep -iE "virtio|eth[0-9]" | head -40 \
    || echo "(dmesg missing or empty)"

echo
echo "=== done ==="
# Let the console catch up, then exit so the VMM reports a clean end.
sleep 2
