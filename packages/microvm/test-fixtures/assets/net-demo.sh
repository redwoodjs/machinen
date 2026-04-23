#!/bin/sh
# Exercise the virtio-net + gvproxy path end to end.
#
# Loads the virtio modules so the kernel probes our device, brings
# eth0 up, then configures a static IP on gvproxy's subnet.
# Reports what we can observe from inside the guest: MAC address,
# tx/rx counters, operstate, IPv4 address, and a ping/curl attempt.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in virtio virtio_ring virtio_mmio failover net_failover virtio_net; do
    load_ko "$m"
done

sleep 1

echo
echo "=== net interfaces ==="
ls /sys/class/net 2>/dev/null || echo "(no /sys/class/net)"

echo
echo "=== eth0 before ==="
echo "mac: $(cat /sys/class/net/eth0/address 2>/dev/null)"
echo "tx_packets: $(cat /sys/class/net/eth0/statistics/tx_packets 2>/dev/null)"
echo "rx_packets: $(cat /sys/class/net/eth0/statistics/rx_packets 2>/dev/null)"
echo "operstate: $(cat /sys/class/net/eth0/operstate 2>/dev/null)"

echo
echo "=== bringing eth0 up ==="
/bin/if-up eth0 && echo "if-up ok" || echo "if-up failed $?"
sleep 1

echo
echo "=== assigning eth0 a static IP (first in gvproxy's DHCP pool) ==="
python3 - <<'PY' 2>&1 | head -12
import socket, fcntl, struct
SIOCSIFADDR = 0x8916
SIOCSIFNETMASK = 0x891C
def pack(ip):
    return struct.pack('16sH2s4s8s', b'eth0', socket.AF_INET, b'\x00\x00', socket.inet_aton(ip), b'\x00'*8)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
fcntl.ioctl(s, SIOCSIFADDR,    pack('192.168.127.2'))
fcntl.ioctl(s, SIOCSIFNETMASK, pack('255.255.255.0'))
print("eth0 configured 192.168.127.2/24")
PY

echo
echo "=== adding default route via gvproxy gateway ==="
/bin/gw-set 192.168.127.1 && echo "default route -> 192.168.127.1" || echo "gw-set failed $?"

echo
echo "=== resolving api.anthropic.com via gvproxy (the real target) ==="
python3 - <<'PY' 2>&1 | head -5
import socket
try:
    print("api.anthropic.com ->", socket.gethostbyname('api.anthropic.com'))
except Exception as e:
    print("dns failed:", e)
PY

echo
echo "=== resolving + fetching example.com via gvproxy ==="
# /etc/resolv.conf points at gvproxy's built-in DNS forwarder (192.168.127.1).
mkdir -p /etc && echo 'nameserver 192.168.127.1' > /etc/resolv.conf
# Use Python (already present) rather than risking a missing curl.
python3 - <<'PY' 2>&1 | head -25
import socket, time
# Try DNS first. gvproxy proxies UDP/53 to the host resolver.
try:
    ip = socket.gethostbyname('example.com')
    print("dns: example.com ->", ip)
except Exception as e:
    print("dns failed:", e)
    ip = '93.184.215.14'  # known example.com address as fallback

# Fetch over TCP.
try:
    s = socket.create_connection((ip, 80), timeout=5)
    s.sendall(b"GET / HTTP/1.0\r\nHost: example.com\r\n\r\n")
    buf = b''
    t0 = time.time()
    while time.time() - t0 < 4 and len(buf) < 512:
        chunk = s.recv(1024)
        if not chunk: break
        buf += chunk
    print("first line:", buf.split(b'\r\n', 1)[0].decode(errors='replace'))
    print("bytes:", len(buf))
except Exception as e:
    print("http failed:", e)
PY
sleep 1

echo
echo "=== eth0 after ==="
echo "tx_packets: $(cat /sys/class/net/eth0/statistics/tx_packets 2>/dev/null)"
echo "rx_packets: $(cat /sys/class/net/eth0/statistics/rx_packets 2>/dev/null)"
echo "operstate: $(cat /sys/class/net/eth0/operstate 2>/dev/null)"
# Read the IPv4 address via Python (always in the rootfs for CRIU reasons).
python3 - <<'PY' 2>/dev/null || true
import socket, fcntl, struct
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    addr = fcntl.ioctl(s.fileno(), 0x8915, struct.pack('256s', b'eth0'[:15]))
    print("ipv4:", socket.inet_ntoa(addr[20:24]))
except Exception as e:
    print("ipv4: (unset:", e, ")")
PY

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
sleep 2
