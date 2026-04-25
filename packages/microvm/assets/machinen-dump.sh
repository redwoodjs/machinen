#!/bin/sh
# /sbin/machinen-dump — dumps the user workload with CRIU onto /dev/vda
# and triggers a clean poweroff.
#
# Runs inside the guest, invoked by `vm.snapshot()` via vsock exec.
# The host-side `vm.snapshot()` then copies /dev/vda's backing file
# to the caller's outPath and returns.
#
# Layout on /dev/vda after a successful dump:
#   /img/core-*.img           ← CRIU images
#   /img/dump.log             ← CRIU verbose log (useful on failure)
#
# Success signal to the host: a clean PSCI SYSTEM_OFF (VMM exits 0)
# before the snapshot timer fires. A non-zero exit here leaves /init's
# waitpid blocked and the kill-timer fires on the host — that's how
# failures surface.

set -eu

# Debian's dash defaults PATH to /usr/bin:/bin when unset — criu,
# blkid, and mkfs.ext4 all live under /usr/sbin, so export a broad
# PATH regardless of what /init's envp carried.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# /init writes the workload's PID after fork. Fall back to PID 2 if
# the file is missing — that's what's produced by the supervisor
# spawning the workload as its first background job.
PIDFILE=/run/machinen-workload.pid
if [ -f "$PIDFILE" ]; then
    DUMP_PID=$(cat "$PIDFILE")
else
    echo "machinen-dump: $PIDFILE missing; falling back to PID 2" >&2
    DUMP_PID=2
fi

case "$DUMP_PID" in
    ''|*[!0-9]*)
        echo "machinen-dump: invalid pid in $PIDFILE: $DUMP_PID" >&2
        exit 1
        ;;
esac

echo "machinen-dump: preparing (pid=$DUMP_PID)"

# CRIU's kerndat_tcp_repair probe fails with ENETUNREACH if `lo` is
# still DOWN. /init doesn't bring it up; we do it here so snapshot is
# self-contained.
/sbin/machinen-lo-up || {
    echo "machinen-dump: lo-up failed" >&2
    exit 1
}

# Format /dev/vda ext4 on first use. Subsequent snapshots just remount.
# -F: force (existing data is a scratch allocation; we're overwriting).
# -q: quiet; noisy output confuses the host-side log tee.
if ! blkid /dev/vda 2>/dev/null | grep -q ext4; then
    echo "machinen-dump: formatting /dev/vda as ext4"
    mkfs.ext4 -F -q /dev/vda
fi
mkdir -p /mnt/snap
mount /dev/vda /mnt/snap

# Clear previous images so a rerun doesn't mix core-*.img files across
# generations. The CRIU restore side globs core-*.img for PID discovery,
# so leftover images would confuse it.
rm -rf /mnt/snap/img
mkdir -p /mnt/snap/img

echo "machinen-dump: dumping tree rooted at pid=$DUMP_PID"
# --tree recurses automatically.
# --shell-job lets CRIU dump processes whose session leader is /init.
# --tcp-established keeps TCP sockets (gvproxy-backed connections etc.)
# -v3 + log file: if dump fails, tail /mnt/snap/img/dump.log on stderr.
if ! criu dump \
        --tree "$DUMP_PID" \
        --images-dir /mnt/snap/img \
        --shell-job \
        --tcp-established \
        -v3 \
        -o dump.log; then
    echo "machinen-dump: CRIU dump failed — tail of dump.log:" >&2
    tail -40 /mnt/snap/img/dump.log >&2 || true
    # Leave the mount + images in place for post-mortem. The host's
    # kill-timer will tear the VM down; the caller sees SNAPSHOT_TIMEOUT.
    exit 1
fi

echo "machinen-dump: dump OK — flushing + unmounting"
sync
umount /mnt/snap
sync

# Don't issue the poweroff here. CRIU's default is to KILL the dumped
# tree on success, which makes /sbin/machinen-supervisor's `wait` on
# the workload return; the supervisor then runs the clean shutdown.
# Racing two poweroffs from different processes works but makes for
# confusing logs; leaving it to the supervisor keeps the shutdown path
# single-sourced.
exit 0
