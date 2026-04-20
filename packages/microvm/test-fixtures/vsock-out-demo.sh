#!/bin/sh
# Guest side of the outbound (#44 M2) smoke.
#
# The guest dials (host_cid=2, port=5678) and expects the bridge to
# have dialled out to a host UDS where a Python echo server upcases
# every byte. We send "hi-out" and assert "HI-OUT" comes back.

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
    echo "vsock-out-demo: /dev/vsock missing"
    exit 1
fi

echo "vsock-out-demo: dialing (cid=2, port=5678)"

python3 - <<'PY'
import socket, sys, time
# Give the host bridge a beat to establish. The VMM brings the bridge
# up before the kernel even boots, but the outbound UDS listener on
# the host side is started by the smoke harness — it races the guest.
for attempt in range(20):
    try:
        s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        s.settimeout(3)
        s.connect((2, 5678))
        break
    except OSError as e:
        print(f"vsock-out-demo: connect attempt {attempt+1} failed: {e!r}", flush=True)
        time.sleep(1)
else:
    print("vsock-out-demo: could not connect after 20 tries", flush=True)
    sys.exit(2)

s.sendall(b"hi-out\n")
data = b""
s.settimeout(5)
t0 = time.time()
while time.time() - t0 < 5 and len(data) < 7:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        data += chunk
    except socket.timeout:
        break
print(f"vsock-out-demo: got {data!r}", flush=True)
if data.strip() == b"HI-OUT":
    print("vsock-out-demo: OUTBOUND OK", flush=True)
else:
    print(f"vsock-out-demo: OUTBOUND MISMATCH (expected b'HI-OUT', got {data!r})", flush=True)
s.close()
PY

# Keep the guest alive a moment so the transcript flushes before we kill it.
sleep 3
echo "vsock-out-demo: done"
