#!/bin/sh
# Drive an actual Claude Code turn from inside the microVM. Requires
# /etc/machinen.env to contain ANTHROPIC_API_KEY=... (the smoke
# harness copies it in from the host's env before repacking).
# Also requires virtio-net + a working network path so the guest can
# reach api.anthropic.com (#46).
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

# Bring virtio-net up end-to-end the same way net-demo.sh does.
load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
for m in virtio virtio_ring virtio_mmio failover net_failover virtio_net; do
    load_ko "$m"
done
sleep 1
/bin/if-up eth0

python3 - <<'PY' 2>/dev/null || true
import socket, fcntl, struct
SIOCSIFADDR=0x8916; SIOCSIFNETMASK=0x891C
def pack(ip):
    return struct.pack('16sH2s4s8s', b'eth0', socket.AF_INET, b'\x00\x00', socket.inet_aton(ip), b'\x00'*8)
s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
fcntl.ioctl(s, SIOCSIFADDR,    pack('192.168.127.2'))
fcntl.ioctl(s, SIOCSIFNETMASK, pack('255.255.255.0'))
PY
/bin/gw-set 192.168.127.1 >/dev/null 2>&1
mkdir -p /etc && echo 'nameserver 192.168.127.1' > /etc/resolv.conf

echo
echo "=== loading API key from /etc/machinen.env ==="
if [ ! -f /etc/machinen.env ]; then
    echo "(no /etc/machinen.env — run with ANTHROPIC_API_KEY in host env)"
    exit 0
fi
# shellcheck disable=SC1091
. /etc/machinen.env
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "(machinen.env did not export ANTHROPIC_API_KEY)"
    exit 0
fi
export ANTHROPIC_API_KEY
echo "ANTHROPIC_API_KEY set (${#ANTHROPIC_API_KEY} chars)"

echo
echo "=== claude --version ==="
claude --version 2>&1 | head -2

echo
echo "=== quick turn: claude -p 'reply with the single word pong' ==="
# -p (print) is CC's non-interactive single-turn mode. 45s cap so we
# fail cleanly if the network path is flaky rather than hanging.
timeout 45 claude -p "reply with the single word pong" 2>&1 | head -20 || echo "(claude exited $?)"

echo
echo "=== done ==="
sleep 2
