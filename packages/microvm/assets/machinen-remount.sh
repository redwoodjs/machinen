#!/bin/sh
# /sbin/machinen-remount — re-establish live-share FUSE mounts after a
# snapshot's unmount/dump window closes (#273).
#
# Invoked by the host via vsock-exec in two situations:
#   - `vm.snapshot({ leaveRunning: true })`: source VM is still alive
#     after the dump; we re-fork fuse-agent so the workload's view of
#     /mnt/<guest> comes back without a reboot.
#   - `vm.fork()` parent half: same path — fork() is snapshot+restore
#     under the hood with the parent kept running, so the parent's
#     live mounts go through the same re-establish.
#
# Reads /etc/machinen-livemounts (TSV `<port>\t<guest>\n`, written by
# /init's bringUpLiveMounts). For each entry: skip if already mounted
# (idempotent — a duplicate invocation is harmless), else fork
# /fuse-agent with the same `<port> <guest>` it ran with originally
# and wait briefly for the mount to appear in /proc/self/mounts.
#
# Failures are reported but non-fatal so a single broken mount doesn't
# block the rest. The host's serveLiveMount instances are listening on
# the same UDS paths the original fuse-agents dialed, so the new
# agents reconnect to fresh server state (the host stops + respawns
# alongside this exec, so there's no inode-table carry-over).
#
# Output goes to stderr; the host's vsock-exec captures it as
# exec-stderr in the snapshot onLog stream.

set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

LIST=${LIVE_MOUNTS_FILE:-/etc/machinen-livemounts}
AGENT=${FUSE_AGENT:-/fuse-agent}
WAIT_MS=${REMOUNT_WAIT_MS:-5000}

if [ ! -r "$LIST" ]; then
    # No live mounts ever existed on this VM. Nothing to do; exit
    # success so the host doesn't surface a spurious failure.
    exit 0
fi

# Wait for `<guest>` to show up in /proc/self/mounts as a fuse-typed
# fs. Mirrors init.zig's waitForFuseMount — the format the kernel
# writes is `fuse <target> fuse rw,...`.
wait_for_mount() {
    target=$1
    timeout_ms=$2
    deadline=$(( $(date +%s%N | cut -c1-13) + timeout_ms ))
    while [ "$(date +%s%N | cut -c1-13)" -lt "$deadline" ]; do
        if grep -qE "^fuse ${target} fuse " /proc/self/mounts 2>/dev/null; then
            return 0
        fi
        sleep 0.05
    done
    return 1
}

bad=""
while IFS="$(printf '\t')" read -r port guest; do
    [ -n "$guest" ] || continue
    [ -n "$port" ] || continue

    if mountpoint -q "$guest" 2>/dev/null; then
        # Already mounted — host did a no-op respawn or this script
        # ran twice. Skip, don't double-fork an agent.
        continue
    fi

    # Make sure the mount point exists on the post-pivot rootfs. /init
    # mkdir -p's it on the first bring-up; restored VMs hit it again
    # here on the chance the rootfs is older than that change.
    mkdir -p "$guest" 2>/dev/null || true

    # Fork the fuse-agent. Same shape as init.zig's startFuseAgent:
    # `<port> <guest>`, lives for the VM lifetime, parent doesn't reap.
    # `setsid` detaches from our controlling tty so SIGHUP from the
    # vsock-exec disconnect doesn't kill the agent.
    setsid "$AGENT" "$port" "$guest" </dev/null >/dev/null 2>&1 &

    if ! wait_for_mount "$guest" "$WAIT_MS"; then
        bad="$bad
  guest=$guest port=$port"
    fi
done < "$LIST"

if [ -n "$bad" ]; then
    cat >&2 <<EOF
machinen-remount: these live mounts did not come back within ${WAIT_MS}ms:$bad
machinen-remount: the host fuse server is likely not listening on the
  expected vsock port — check the runtime's serveLiveMount respawn.
EOF
    exit 1
fi

exit 0
