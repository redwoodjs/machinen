#!/bin/sh
# /sbin/machinen-restore — restores a CRIU dump from a tar archive
# attached as the scratch block device, then supervises the restored
# workload until it exits.
#
# The runtime invokes /sbin/machinen-restore as PID 1. Its first action is to
# exec the compiled supervisor, which launches this script again with --worker.
# This file then owns only CRIU setup and restore-specific signal forwarding;
# the supervisor owns shared lifecycle cleanup and poweroff.
#
# Bundle delivery (#266): the host attaches the bundle as a raw tar
# archive on the scratch block device (no filesystem). We untar into
# tmpfs and run criu against that. The old ext4-on-blk delivery was
# replaced because the new bundle format on the host is a directory
# of CRIU image files; staging through tar avoids any need for the
# host to mkfs ext4.

if [ "${1:-}" != "--worker" ]; then
    exec /sbin/machinen-supervisor --restore
    echo "machinen-restore: failed to exec supervisor" >&2
    exit 127
fi
shift
set -eu

LAZY_PAGES_PID=""
UNSHARE_PID=""
CRIU_HOST_PID=""

restore_exit() {
    restore_status=$?
    trap - 0 TERM INT
    case "$LAZY_PAGES_PID" in
        ''|*[!0-9]*) ;;
        *) kill -TERM "$LAZY_PAGES_PID" 2>/dev/null || true ;;
    esac
    exit "$restore_status"
}
trap restore_exit 0

# wait(1) can return early when this shell handles TERM/INT. Keep waiting
# while the restore process is alive so the outer supervisor never syncs
# against a still-running restored workload.
machinen_wait() {
    wait_pid=$1
    while :; do
        wait "$wait_pid"
        wait_status=$?
        if kill -0 "$wait_pid" 2>/dev/null; then
            continue
        fi
        return "$wait_status"
    done
}

restore_signal_workload() {
    restore_signal=$1
    workload_pid=$(cat /run/machinen-workload.pid 2>/dev/null || true)
    case "$workload_pid:$CRIU_HOST_PID" in
        *[!0-9:]*|:*|*:) return 1 ;;
    esac
    nsenter --target "$CRIU_HOST_PID" --pid --mount --root --wd=/ -- \
        /usr/bin/sh -c \
        'kill "-$1" -- "-$2" 2>/dev/null || kill "-$1" "$2"' \
        sh "$restore_signal" "$workload_pid"
}

restore_forward_signal() {
    restore_signal=$1
    echo "machinen-restore: forwarding $restore_signal to restored workload" >&2
    if restore_signal_workload "$restore_signal" ||
        kill "-$restore_signal" "$UNSHARE_PID" 2>/dev/null; then
        return
    fi
    echo "machinen-restore: failed to signal restored workload through pid namespace" >&2
    case "$restore_signal" in
        TERM) exit 143 ;;
        INT) exit 130 ;;
    esac
}

trap 'restore_forward_signal TERM' TERM
trap 'restore_forward_signal INT' INT

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

# Bundle delivery (#266 final): the host exposes its bundle `img/`
# directory at /mnt/snap-src/img read-only via the VMM's virtio-fs live
# mount and signals us with MACHINEN_RESTORE_BUNDLE_LIVE=1. Reads stream
# from the host's bundle on demand — no tmpfs duplicate copy. Legacy mode
# (no env) falls back to untarring /dev/vdb into tmpfs.
mkdir -p /mnt/snap-src/img
if [ "${MACHINEN_RESTORE_BUNDLE_LIVE:-0}" = "1" ]; then
    if [ -z "$(ls -A /mnt/snap-src/img 2>/dev/null)" ]; then
        echo "machinen-restore: live-mounted bundle at /mnt/snap-src/img is empty" >&2
        exit 1
    fi
    echo "machinen-restore: bundle live-mounted at /mnt/snap-src/img" >&2
else
    if [ -b /dev/vdb ]; then
        SCRATCH=/dev/vdb
    else
        SCRATCH=/dev/vda
    fi
    echo "machinen-restore: untarring $SCRATCH into /mnt/snap-src/img" >&2
    if ! tar -xmf "$SCRATCH" -C /mnt/snap-src/img; then
        echo "machinen-restore: failed to untar bundle from $SCRATCH" >&2
        exit 1
    fi
    if [ -z "$(ls -A /mnt/snap-src/img 2>/dev/null)" ]; then
        echo "machinen-restore: bundle on $SCRATCH was empty" >&2
        exit 1
    fi
fi

# Lazy-pages mode (#266): when MACHINEN_RESTORE_LAZY_PAGES=1, run a
# `criu lazy-pages` daemon alongside `criu restore --lazy-pages`. The
# daemon reads pagemap-*.img + pages-*.img from /mnt/snap-src/img,
# which (with MACHINEN_RESTORE_BUNDLE_LIVE=1) is a virtio-fs mount of
# the host bundle dir — bytes stream from the host on demand.
LAZY_FLAGS=""
if [ "${MACHINEN_RESTORE_LAZY_PAGES:-0}" = "1" ]; then
    echo "machinen-restore: lazy-pages mode — daemon reads bundle locally" >&2
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
    # Spawn the lazy-pages daemon BEFORE criu restore. It opens
    # /tmp/lazy-pages.socket and serves UFFD page faults from
    # pages-*.img in /mnt/snap-src/img — which is the host's bundle
    # over virtio-fs in live-mount mode. The daemon must outlive
    # `criu restore` because UFFD events keep flowing as the workload
    # runs.
    criu lazy-pages \
        --images-dir /mnt/snap-src/img \
        --work-dir /tmp \
        -v3 \
        -o lazy-pages.log &
    LAZY_PAGES_PID=$!
    echo "machinen-restore: lazy-pages daemon pid=$LAZY_PAGES_PID" >&2

    # Wait for the daemon to bind /tmp/lazy-pages.socket before we
    # start criu restore — restore connects to that socket near the
    # end of its own setup and exits with criu/uffd.c:349 (ENOENT)
    # if it loses the race. Bail if the daemon dies during startup.
    for _ in $(seq 1 50); do
        if [ -S /tmp/lazy-pages.socket ]; then
            break
        fi
        if ! kill -0 "$LAZY_PAGES_PID" 2>/dev/null; then
            echo "machinen-restore: lazy-pages daemon exited before socket appeared" >&2
            tail -200 /tmp/lazy-pages.log >&2 || true
            exit 1
        fi
        sleep 0.1
    done
    if [ ! -S /tmp/lazy-pages.socket ]; then
        echo "machinen-restore: timed out waiting for /tmp/lazy-pages.socket" >&2
        tail -200 /tmp/lazy-pages.log >&2 || true
        kill -TERM "$LAZY_PAGES_PID" 2>/dev/null || true
        exit 1
    fi
    echo "machinen-restore: lazy-pages daemon ready (UDS bound)" >&2
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
# courtesy of no -d). machinen_wait survives a trapped signal interrupt;
# `|| RC=$?` keeps set -e from skipping diagnostics and final cleanup.
RC=0
machinen_wait "$UNSHARE_PID" || RC=$?
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
    fi
fi

# The outer compiled supervisor retains RC, performs final sync and sidecar
# shutdown, then powers off without a PID 1 panic.
exit "$RC"
