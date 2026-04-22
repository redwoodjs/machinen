#!/bin/sh
# Exercise the virtio-blk device. Loads the driver, reads the first
# block of /dev/vda, and prints what's there.
#
# The host side places a known marker at offset 0 of disk.img so the
# smoke test can assert a round trip: `dd if=/dev/vda bs=64 count=1`
# should return that marker.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in virtio virtio_ring virtio_mmio virtio_blk; do
    load_ko "$m"
done

sleep 1

echo
echo "=== virtio bus devices ==="
if [ -d /sys/bus/virtio/devices ]; then
    for d in /sys/bus/virtio/devices/*; do
        [ -e "$d" ] || continue
        device_id=$(cat "$d/device" 2>/dev/null)
        echo "$(basename "$d") device=$device_id"
    done
fi

echo
echo "=== /dev/vda ==="
ls -la /dev/vda 2>&1 | head -1
echo "size bytes: $(cat /sys/class/block/vda/size 2>/dev/null) (in 512-byte sectors)"

echo
echo "=== read first 64 bytes from /dev/vda ==="
dd if=/dev/vda bs=64 count=1 2>/dev/null

echo
echo "=== write a marker, flush, re-read ==="
printf 'MACHINEN_GUEST_WROTE_THIS\n' | dd of=/dev/vda bs=1 count=25 seek=512 conv=notrunc 2>/dev/null
sync
# Drop caches so the next read actually hits the device.
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
echo "readback at sector 1 (bs=512 skip=1):"
dd if=/dev/vda bs=512 count=1 skip=1 2>/dev/null | head -c 64

echo
echo "=== done ==="
sleep 2
