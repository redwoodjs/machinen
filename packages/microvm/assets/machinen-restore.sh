#!/bin/sh
# /sbin/machinen-restore — restores a CRIU dump from a tar archive
# attached as the scratch block device, then supervises the restored
# workload until it exits.
#
# Invoked as /init's direct child (via cmd=["/sbin/machinen-restore"]
# synthesized by the runtime when boot() gets an opts.snapshot but
# no opts.cmd). Counterpart of /sbin/machinen-supervisor — same
# "restore vsock + wait + poweroff" shape, just with the workload
# coming from a CRIU image set instead of a fresh fork+execve.
#
# Bundle delivery (#266): the host attaches the bundle as a raw tar
# archive on the scratch block device (no filesystem). We untar into
# tmpfs and run criu against that. The old ext4-on-blk delivery was
# replaced because the new bundle format on the host is a directory
# of CRIU image files; staging through tar avoids any need for the
# host to mkfs ext4.

set -eu

# Debian's dash defaults PATH to /usr/bin:/bin when unset, which
# leaves criu (in /usr/sbin) and unshare/nsenter unreachable. Export
# a broad PATH regardless of what /init's envp carried.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Bring up loopback so the restored processes see a live lo interface.
# Some workloads fail their first syscall after restore if lo is DOWN
# (TCP kerndat, IPv6 probes, etc.).
/sbin/machinen-lo-up || echo "machinen-restore: lo-up failed" >&2

# /tmp must exist for CRIU's kerndat probes (kerndat_has_move_mount_set_group
# mkdirs `/tmp/.criu.move_mount_set_group.XXXXXX`). The base rootfs ships
# /tmp 1777, but be defensive in case a layered image (app.tar.gz) stripped
# it — without /tmp here, criu restore fails kerndat init, exits 1, and
# /init dying with that exit code panics the kernel ("Attempted to kill
# init!"), which is a much more confusing failure than a clean error.
mkdir -p /tmp /run
chmod 1777 /tmp 2>/dev/null || true

# Spawn a fresh exec-agent so vm.exec / vm.snapshot work on the
# restored VM. The original dump tree did NOT include exec-agent —
# that was a sibling under the supervisor, not a descendant of the
# workload — so vsock port 1978 is unclaimed after restore.
/exec-agent </dev/null >/dev/null 2>&1 &
AGENT_PID=$!

# winsize-agent (vsock 1974, see #177) — sibling of the restored
# workload, mirrors what the supervisor does on a fresh boot. Optional.
WINSIZE_PID=""
if [ -x /sbin/machinen-winsize-agent ]; then
    /sbin/machinen-winsize-agent </dev/null >/dev/null 2>&1 &
    WINSIZE_PID=$!
fi

# Pick the scratch block device: /dev/vdb when virtio-blk-root booted
# (rootfs took /dev/vda); else /dev/vda for the legacy single-disk
# layout. See #114.
if [ -b /dev/vdb ]; then
    SCRATCH=/dev/vdb
else
    SCRATCH=/dev/vda
fi

# Untar the bundle off the raw block device into /mnt/snap-src/img.
# /mnt/snap-src lives on the rootfs (tmpfs-style); a future
# `machinen snapshot` against this VM will write its OWN dump to the
# scratch disk via /mnt/snap, so we keep the two paths separate (#207).
mkdir -p /mnt/snap-src/img
echo "machinen-restore: untarring $SCRATCH into /mnt/snap-src/img" >&2
if ! tar -xmf "$SCRATCH" -C /mnt/snap-src/img; then
    echo "machinen-restore: failed to untar bundle from $SCRATCH" >&2
    exit 1
fi
if [ -z "$(ls -A /mnt/snap-src/img 2>/dev/null)" ]; then
    echo "machinen-restore: bundle on $SCRATCH was empty" >&2
    exit 1
fi

# Lazy-pages mode (#266): when the host has spawned a page-server and
# plumbed `MACHINEN_RESTORE_PAGE_SERVER=<addr>:<port>` into our env,
# split the restore in two:
#   1. `criu lazy-pages` opens a UDS at /tmp/lazy-pages.socket and
#      forwards UFFD page requests to the host page-server over TCP.
#   2. `criu restore --lazy-pages` skips the eager copy of pagemap
#      entries flagged PE_LAZY and registers UFFD on those VMA's,
#      then defers to the lazy-pages daemon.
# Both must live in the same PID-NS we set up for the restore (#215),
# so we put the daemon under the same `unshare`. lazy-pages talks to
# the daemon via a UDS in /tmp (--work-dir keeps it off any read-only
# mounts).
LAZY_FLAGS=""
LAZY_PAGES_PID=""
if [ -n "${MACHINEN_RESTORE_PAGE_SERVER:-}" ]; then
    case "$MACHINEN_RESTORE_PAGE_SERVER" in
        *:*)
            LAZY_ADDR="${MACHINEN_RESTORE_PAGE_SERVER%:*}"
            LAZY_PORT="${MACHINEN_RESTORE_PAGE_SERVER##*:}"
            ;;
        *)
            echo "machinen-restore: MACHINEN_RESTORE_PAGE_SERVER must be 'addr:port', got '$MACHINEN_RESTORE_PAGE_SERVER'" >&2
            exit 1
            ;;
    esac
    echo "machinen-restore: lazy-pages mode — page-server $LAZY_ADDR:$LAZY_PORT" >&2
    LAZY_FLAGS="--lazy-pages"
fi

echo "machinen-restore: starting criu restore in a fresh PID namespace" >&2
# Run criu inside `unshare --pid --fork --mount-proc` so the restored
# workload's PIDs land in a fresh namespace (#215). Without this, the
# dumped tree's PIDs (e.g. 60, 73, 77 — captured wherever the source
# VM's PID counter happened to sit) collide with PIDs already
# allocated to /exec-agent, machinen-winsize-agent, and the
# mount/blkid/grep/mkdir helpers above, and `criu` aborts with
# `clone3(set_tid=N): EEXIST`. Burning PIDs in the parent NS is
# unreliable because the dumped range is open-ended (longer chains
# amplify it); a fresh sub-NS guarantees the dumped PIDs are free.
#
# --pid: new PID namespace.
# --fork: required because unshare(CLONE_NEWPID) only takes effect for
#   the calling process's children; --fork makes unshare actually do
#   that fork before exec'ing criu, so criu becomes PID 1 of the new NS.
# --mount-proc: clones the mount namespace and remounts /proc to
#   reflect the new PID NS. Without this, criu would read the parent's
#   /proc and see PIDs that don't match its own NS.
#
# We background the unshare so we can record the criu host PID before
# `wait`-ing — `/sbin/machinen-dump` needs it to nsenter the sub-NS
# on a chained snapshot.
#
# --pidfile writes the restored task's pid (in the new NS) — useful for
# `criu dump --tree <pid>` after we nsenter into the sub-NS. The
# corresponding host PID is captured below.
#
# --work-dir /tmp keeps logs + per-restore working state off the
# read-only bundle mount. CRIU writes `restore.log` (and stats / aux
# scratch) here.
if [ -n "$LAZY_FLAGS" ]; then
    # Spawn the lazy-pages daemon BEFORE criu restore. It connects to
    # the host page-server, opens /tmp/lazy-pages.socket, and waits for
    # criu restore to coordinate. The daemon must outlive `criu restore`
    # because UFFD events keep flowing as the workload runs.
    criu lazy-pages \
        --images-dir /mnt/snap-src/img \
        --work-dir /tmp \
        --address "$LAZY_ADDR" \
        --port "$LAZY_PORT" \
        --page-server \
        -v3 \
        -o lazy-pages.log &
    LAZY_PAGES_PID=$!
    echo "machinen-restore: lazy-pages daemon pid=$LAZY_PAGES_PID" >&2
fi
# shellcheck disable=SC2086 # word splitting on LAZY_FLAGS is intentional
unshare --pid --fork --mount-proc -- \
        criu restore \
            --images-dir /mnt/snap-src/img \
            --work-dir /tmp \
            --tcp-established \
            $LAZY_FLAGS \
            --pidfile /run/machinen-workload.pid \
            -v3 \
            -o restore.log &
UNSHARE_PID=$!

# Discover the criu host PID (the sole child of the unshare process).
# /proc/<pid>/task/<pid>/children is space-separated; in our case
# there's exactly one entry — the forked child that exec'd criu.
# Loop briefly because unshare's fork happens after we capture $!.
CRIU_HOST_PID=""
i=0
while [ $i -lt 50 ]; do
    if [ -r "/proc/$UNSHARE_PID/task/$UNSHARE_PID/children" ]; then
        first=$(cut -d' ' -f1 < "/proc/$UNSHARE_PID/task/$UNSHARE_PID/children" 2>/dev/null || true)
        case "$first" in
            ''|*[!0-9]*) ;;
            *) CRIU_HOST_PID="$first"; break ;;
        esac
    fi
    sleep 0.1
    i=$((i + 1))
done

# Persist the criu host PID for /sbin/machinen-dump. Empty means a
# chained snapshot will refuse to dump and the user gets a clear
# error rather than CRIU walking the wrong tree.
if [ -n "$CRIU_HOST_PID" ]; then
    printf '%s' "$CRIU_HOST_PID" > /run/machinen-workload-host.pid
else
    echo "machinen-restore: warning — could not discover criu host PID" >&2
fi

# Wait for criu to finish (it blocks until the restored tree exits,
# courtesy of no -d). Using `|| RC=$?` keeps `set -e` from yanking us
# before we can drain logs and signal the agents.
RC=0
wait "$UNSHARE_PID" || RC=$?
if [ "$RC" -ne 0 ]; then
    # tail -40 of a v3 log is dominated by per-fd restore noise and
    # rarely captures the actual error. Print Err/Warn lines first so
    # the cause is visible even when the panic scrolls the console.
    echo "machinen-restore: CRIU restore failed (rc=$RC) — Err/Warn from restore.log:" >&2
    grep -E "^(Error|Warn|\([0-9.]+\)\s+[0-9]+:\s*(Error|Warn))" /tmp/restore.log >&2 || true
    echo "machinen-restore: --- last 200 lines of restore.log ---" >&2
    tail -200 /tmp/restore.log >&2 || true
    if [ -n "$LAZY_PAGES_PID" ]; then
        echo "machinen-restore: --- last 200 lines of lazy-pages.log ---" >&2
        tail -200 /tmp/lazy-pages.log >&2 || true
        kill -TERM "$LAZY_PAGES_PID" 2>/dev/null || true
    fi
    kill -TERM "$AGENT_PID" 2>/dev/null || true
    if [ -n "$WINSIZE_PID" ]; then
        kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    fi
    exit 1
fi

# Restored tree exited cleanly. Stop the lazy-pages daemon (if any) and
# the agents, then power off. lazy-pages exits on its own when criu
# restore signals completion and the workload's UFFD fds drain, but
# SIGTERM-after-exit is harmless and keeps the cleanup uniform.
if [ -n "$LAZY_PAGES_PID" ]; then
    kill -TERM "$LAZY_PAGES_PID" 2>/dev/null || true
    wait "$LAZY_PAGES_PID" 2>/dev/null || true
fi
kill -TERM "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
if [ -n "$WINSIZE_PID" ]; then
    kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    wait "$WINSIZE_PID" 2>/dev/null || true
fi
exec /sbin/machinen-poweroff
