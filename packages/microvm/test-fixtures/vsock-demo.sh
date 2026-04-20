#!/bin/sh
# Guest side of the #44 M1 smoke test.
#
# What we do inside the guest:
#   1. Load the AF_VSOCK kernel modules (they're modules in this
#      Debian kernel, not built-in).
#   2. Launch a tiny Python AF_VSOCK echo server on port 1234.
#   3. Print a marker line so the smoke harness knows we're ready.
#
# The host side (try.sh / smoke.sh) opens the UDS the VMM listens
# on, which the vsock bridge forwards into this guest port.

PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}

# Order matters: vsock core, virtio transport common, virtio transport.
for m in vsock vmw_vsock_virtio_transport_common virtio virtio_ring virtio_mmio vmw_vsock_virtio_transport; do
    load_ko "$m"
done

# Confirm /dev/vsock now exists — that's what the kernel creates when
# a vsock transport binds.
if [ ! -c /dev/vsock ]; then
    echo "vsock-demo: /dev/vsock missing; transport probably didn't bind"
    dmesg 2>/dev/null | grep -Ei "vsock|virtio" | tail -20
    exit 1
fi

# Report our CID so the host knows what it's talking to.
if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import socket
s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
# SO_VSOCK_LOCAL_CID: get our guest CID. getsockname after bind works too.
try:
    import fcntl, struct
    IOCTL_VM_SOCKETS_GET_LOCAL_CID = 0x7b9
    buf = bytearray(4)
    fcntl.ioctl(s.fileno(), IOCTL_VM_SOCKETS_GET_LOCAL_CID, buf)
    cid = int.from_bytes(buf, "little")
    print(f"vsock-demo: guest CID = {cid}")
except Exception as e:
    print(f"vsock-demo: could not query CID: {e!r}")
s.close()
PY
fi

echo "vsock-demo: starting echo server on port 1234"
# Python echo server: every byte in == byte out. Stays alive so the
# host can reconnect multiple times.
python3 - <<'PY' &
import socket
srv = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
srv.bind((socket.VMADDR_CID_ANY, 1234))
srv.listen(4)
print("vsock-demo: listening on CID=any port=1234", flush=True)
while True:
    c, addr = srv.accept()
    print(f"vsock-demo: accepted from {addr}", flush=True)
    try:
        while True:
            data = c.recv(4096)
            if not data:
                break
            c.sendall(data)
    except Exception as e:
        print(f"vsock-demo: conn error: {e!r}", flush=True)
    finally:
        c.close()
        print("vsock-demo: conn closed", flush=True)
PY
SERVER_PID=$!

# Keep the guest alive so the host can probe.
echo "vsock-demo: ready (server pid=$SERVER_PID). Sleeping."
while kill -0 "$SERVER_PID" 2>/dev/null; do
    sleep 2
done
echo "vsock-demo: server exited"
