#!/bin/sh
# /sbin/machinen-restore — restores a CRIU dump from /dev/vda and
# supervises the restored workload until it exits.
#
# Invoked as /init's direct child (via cmd=["/sbin/machinen-restore"]
# synthesized by the runtime when boot() gets an opts.snapshot but
# no opts.cmd). Counterpart of /sbin/machinen-supervisor — same
# "restore vsock + wait + poweroff" shape, just with the workload
# coming from a CRIU image set instead of a fresh fork+execve.

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

# Mount the CRIU image store. Pick /dev/vdb when virtio-blk-root booted
# (rootfs took /dev/vda); else /dev/vda for the legacy single-disk
# layout. See #114.
if [ -b /dev/vdb ]; then
    SCRATCH=/dev/vdb
else
    SCRATCH=/dev/vda
fi

# Mount the bundle disk at /mnt/snap-src (NOT /mnt/snap) so a future
# `machinen snapshot` against the restored VM can use /mnt/snap as its
# own scratch mountpoint without colliding (#207). machinen-dump.sh
# unmounts /mnt/snap-src before re-formatting the disk for the new dump;
# see that script for the cleanup.
mkdir -p /mnt/snap-src
if ! blkid "$SCRATCH" 2>/dev/null | grep -q ext4; then
    echo "machinen-restore: $SCRATCH is not ext4 — aborting" >&2
    exit 1
fi
mount -o ro "$SCRATCH" /mnt/snap-src
if [ ! -d /mnt/snap-src/img ] || [ -z "$(ls -A /mnt/snap-src/img 2>/dev/null)" ]; then
    echo "machinen-restore: no images at /mnt/snap-src/img — aborting" >&2
    exit 1
fi

# Lazy vs eager mode (#263 phase C).
#
# Default: lazy. CRIU restore registers userfaultfd over the workload's
# address space; pages are served on demand by a lazy-pages daemon
# reading from the bundle. First-touch latency goes up, restore-time
# RSS goes way down — a freshly restored fork starts at ~baseline
# instead of pre-loading everything the parent ever touched.
#
# Opt-out: set MACHINEN_RESTORE_EAGER=1 in the guest env (which the
# runtime forwards via opts.env when boot({ eager: true }) is set).
# Eager loads every page up front, same as the legacy v3 / 4.x default.
RESTORE_MODE=lazy
if [ "${MACHINEN_RESTORE_EAGER:-}" = "1" ]; then
    RESTORE_MODE=eager
fi

# Spawn the lazy-pages daemon BEFORE `criu restore` so its socket is
# already listening when the restorer connects. Stays in the parent
# NS — userfaultfd is per-mm (memory-management context), not per-PID-
# NS, so pages can be served across the unshare boundary.
#
# CRIU 4.x hardcodes the local-UDS path to `<work-dir>/lazy-pages.socket`
# (the --address flag is for network-mode lazy migration only — passing
# a UDS path there is silently ignored, which surfaces as "socket
# never appeared" because we'd be looking at the wrong path). Both
# the daemon and the restorer must point at the same hardcoded path.
LAZY_SOCK=/tmp/lazy-pages.socket
LAZY_PID=""
if [ "$RESTORE_MODE" = lazy ]; then
    echo "machinen-restore: starting criu lazy-pages daemon (mode=lazy)"
    rm -f "$LAZY_SOCK"
    criu lazy-pages \
        --images-dir /mnt/snap-src/img \
        --work-dir /tmp \
        -v3 \
        -o lazy-pages.log &
    LAZY_PID=$!
    # Wait for the socket to appear (typical: <100 ms). Bail early
    # if the daemon process dies — no point waiting for a socket the
    # dead process can never bind.
    i=0
    while [ $i -lt 100 ] && [ ! -S "$LAZY_SOCK" ]; do
        if ! kill -0 "$LAZY_PID" 2>/dev/null; then
            wait "$LAZY_PID" 2>/dev/null
            LAZY_RC=$?
            echo "machinen-restore: lazy-pages daemon exited rc=$LAZY_RC before binding socket" >&2
            if [ -r /tmp/lazy-pages.log ]; then
                echo "machinen-restore: --- full lazy-pages.log ---" >&2
                cat /tmp/lazy-pages.log >&2 || true
            fi
            LAZY_PID=""
            RESTORE_MODE=eager
            break
        fi
        sleep 0.05
        i=$((i + 1))
    done
    if [ "$RESTORE_MODE" = lazy ] && [ ! -S "$LAZY_SOCK" ]; then
        echo "machinen-restore: lazy-pages socket never appeared after 5s — falling back to eager" >&2
        if [ -r /tmp/lazy-pages.log ]; then
            echo "machinen-restore: --- full lazy-pages.log ---" >&2
            cat /tmp/lazy-pages.log >&2 || true
        fi
        kill -TERM "$LAZY_PID" 2>/dev/null || true
        wait "$LAZY_PID" 2>/dev/null || true
        LAZY_PID=""
        RESTORE_MODE=eager
    fi
fi

echo "machinen-restore: starting criu restore (mode=$RESTORE_MODE) in a fresh PID namespace"
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
# scratch) here; without --work-dir it'd default to --images-dir and
# fail with "Can't create log file restore.log: Read-only file system"
# on v4.2 (3.17.1 was lenient about this and didn't always need to
# write the log).
#
# `--lazy-pages` (in lazy mode) tells the restorer to register
# userfaultfd over the restored memory and forward fault requests
# to the lazy-pages daemon. Memory pages aren't pre-loaded — they're
# served on first-touch. Without this flag CRIU does the legacy eager
# copy-everything path. The daemon and restorer find each other via
# the hardcoded `<work-dir>/lazy-pages.socket` path; no --address.
LAZY_FLAGS=""
if [ "$RESTORE_MODE" = lazy ]; then
    LAZY_FLAGS=--lazy-pages
fi
# shellcheck disable=SC2086 # word splitting is intentional for $LAZY_FLAGS
unshare --pid --fork --mount-proc -- \
        criu restore \
            --images-dir /mnt/snap-src/img \
            --work-dir /tmp \
            --tcp-established \
            --pidfile /run/machinen-workload.pid \
            $LAZY_FLAGS \
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
    if [ -n "$LAZY_PID" ]; then
        echo "machinen-restore: --- last 100 lines of lazy-pages.log ---" >&2
        tail -100 /tmp/lazy-pages.log >&2 || true
        kill -TERM "$LAZY_PID" 2>/dev/null || true
    fi
    kill -TERM "$AGENT_PID" 2>/dev/null || true
    if [ -n "$WINSIZE_PID" ]; then
        kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    fi
    exit 1
fi

# Restored tree exited cleanly. Stop the agents and power off.
# The lazy-pages daemon (if any) usually exits on its own once all
# pages have been served; SIGTERM it as a safety net so it can't
# outlive the workload.
if [ -n "$LAZY_PID" ]; then
    kill -TERM "$LAZY_PID" 2>/dev/null || true
    wait "$LAZY_PID" 2>/dev/null || true
fi
kill -TERM "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
if [ -n "$WINSIZE_PID" ]; then
    kill -TERM "$WINSIZE_PID" 2>/dev/null || true
    wait "$WINSIZE_PID" 2>/dev/null || true
fi
exec /sbin/machinen-poweroff
