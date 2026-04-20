#!/bin/sh
# Guest side of #48 M3 — Claude Code with a vsock-injected API key.
#
# Unlike cc-session.sh (which assumes /etc/machinen.env was baked
# into the initramfs by the host harness), this one:
#
#   1. Loads vsock kernel modules.
#   2. Starts secrets-agent.py. The agent binds AF_VSOCK port 1975
#      and blocks on accept until the host pushes secrets.
#   3. Waits for /etc/machinen.env to appear (the agent writes it
#      after receiving).
#   4. execs cc-session.sh, which sources the env as it always has.
#
# The initramfs never contains the key. Rotation is a per-boot thing.

PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}

# vsock transport first — without it secrets-agent can't bind.
for m in vsock vmw_vsock_virtio_transport_common virtio virtio_ring virtio_mmio vmw_vsock_virtio_transport; do
    load_ko "$m"
done

if [ ! -c /dev/vsock ]; then
    echo "cc-session-vsock: /dev/vsock missing; transport didn't bind"
    exit 1
fi

echo "cc-session-vsock: starting secrets agent"
rm -f /etc/machinen.env
python3 /secrets-agent.py &
AGENT_PID=$!

# Wait up to 60s for the agent to write the env file. The host will
# usually push secrets within a second or two once the VMM is up.
i=0
while [ $i -lt 60 ]; do
    if [ -f /etc/machinen.env ]; then break; fi
    sleep 1
    i=$((i + 1))
done

if [ ! -f /etc/machinen.env ]; then
    echo "cc-session-vsock: timed out waiting for secrets"
    kill $AGENT_PID 2>/dev/null
    exit 1
fi

# The agent has already exited at this point (single-shot), but make
# sure we don't leak a zombie if the timing is odd.
wait $AGENT_PID 2>/dev/null

echo "cc-session-vsock: secrets received; handing off to cc-session.sh"
exec /bin/sh /cc-session.sh
