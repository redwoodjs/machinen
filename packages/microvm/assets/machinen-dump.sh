#!/bin/sh
# /sbin/machinen-dump — dumps the user workload with CRIU onto the
# scratch disk and triggers a clean poweroff.
#
# Runs inside the guest, invoked by `vm.snapshot()` via vsock exec.
# The host-side `vm.snapshot()` then copies the scratch disk's backing
# file to the caller's outPath and returns.
#
# Scratch disk lives at /dev/vdb when the VM was booted with virtio-blk
# root (/dev/vda is the rootfs in that case — see #114). On legacy
# initramfs-as-rootfs boots there's only one virtio-blk device and it
# lands at /dev/vda, so we fall back to that. The first existing path
# wins.
#
# Layout on the scratch disk after a successful dump:
#   /img/core-*.img           ← CRIU images
#   /img/dump.log             ← CRIU verbose log (useful on failure)
#
# Success signal to the host: a clean PSCI SYSTEM_OFF (VMM exits 0)
# before the snapshot timer fires. A non-zero exit here leaves /init's
# waitpid blocked and the kill-timer fires on the host — that's how
# failures surface.

set -eu

# Debian's dash defaults PATH to /usr/bin:/bin when unset — criu,
# blkid, mkfs.ext4, and nsenter all live under /usr/sbin or /usr/bin,
# so export a broad PATH regardless of what /init's envp carried.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Recursive-self-exec marker: when we re-enter via `nsenter` for the
# chained-restore case (#215), the second pass skips the discovery
# logic and trusts the in-NS pid passed on the command line.
IN_SUB_NS=0
case "${1:-}" in
    --in-sub-ns)
        IN_SUB_NS=1
        shift
        ;;
esac

# Pick the scratch disk: /dev/vdb when virtio-blk-root booted (rootfs
# took /dev/vda); else /dev/vda for the legacy single-disk layout.
if [ -b /dev/vdb ]; then
    SCRATCH=/dev/vdb
else
    SCRATCH=/dev/vda
fi

if [ "$IN_SUB_NS" -eq 1 ]; then
    # Inside the sub-PID-NS now. The first arg is the in-NS pid that
    # criu restore wrote via --pidfile.
    DUMP_PID="${1:-}"
    SUB_NS_HOST_PID=""
else
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

    # /sbin/machinen-restore writes the host PID of the criu restorer
    # when the restored workload was placed in a sub-PID-namespace
    # (#215). Presence of this file means we're in the chained-restore
    # case: we need to re-enter the sub-NS via nsenter, because criu
    # walks /proc and /proc reflects the parent NS out here.
    SUB_NS_HOST_PID_FILE=/run/machinen-workload-host.pid
    SUB_NS_HOST_PID=""
    if [ -s "$SUB_NS_HOST_PID_FILE" ]; then
        candidate=$(cat "$SUB_NS_HOST_PID_FILE")
        case "$candidate" in
            ''|*[!0-9]*)
                echo "machinen-dump: invalid pid in $SUB_NS_HOST_PID_FILE: $candidate" >&2
                exit 1
                ;;
            *)
                if [ -d "/proc/$candidate" ]; then
                    SUB_NS_HOST_PID="$candidate"
                else
                    echo "machinen-dump: criu host PID $candidate is gone — sub-NS died" >&2
                    exit 1
                fi
                ;;
        esac
    fi
fi

case "$DUMP_PID" in
    ''|*[!0-9]*)
        echo "machinen-dump: invalid dump pid: $DUMP_PID" >&2
        exit 1
        ;;
esac

echo "machinen-dump: preparing (pid=$DUMP_PID, sub_ns=${SUB_NS_HOST_PID:-none}, in_sub_ns=$IN_SUB_NS)"

if [ "$IN_SUB_NS" -eq 0 ] && [ -n "$SUB_NS_HOST_PID" ]; then
    # Drop the parent's read-only bundle mount before we hand off to
    # the sub-NS — mkfs (re-)formats the device from inside, and we
    # don't want the parent to keep an open ref. The sub-NS has its
    # own copy of /mnt/snap-src (cloned at unshare time); the
    # re-entered half umounts that one.
    if mountpoint -q /mnt/snap-src 2>/dev/null; then
        umount /mnt/snap-src 2>/dev/null || umount -l /mnt/snap-src
    fi

    # Re-enter the sub-PID + sub-mount NS by re-exec'ing ourselves.
    # nsenter forks a child into the target NS; the child's exit
    # status comes back as nsenter's exit. We don't `exec` here
    # because the sub-NS dies as soon as criu kills the dumped tree
    # (criu_restore is PID 1 of the NS and exits the moment its
    # workload is gone) — and the kernel SIGKILLs everything
    # remaining in that NS, including our re-exec'd self mid-cleanup.
    # We need the parent to survive the nsenter exit to flush the
    # block device and verify the dump landed on disk.
    #
    # /usr/sbin/machinen-dump (not /sbin/...) — the sub-NS's mount
    # namespace was cloned by `unshare --mount-proc`, but Debian's
    # /sbin → /usr/sbin merge is a top-level symlink and CRIU may
    # have pivoted into a private root that doesn't see it. Going
    # through the canonical path skips the dependency.
    # `--root` switches the process's fs root to the target's root
    # before exec. Without it, our process keeps its parent-NS chroot
    # view and path lookup into the new mount NS misses everything
    # (every "/usr/sbin/foo" comes back ENOENT) — the rootfs IS
    # there, just not at the path our chroot points to. `--wd /` is
    # belt-and-braces in case the parent's cwd doesn't exist in the
    # target NS.
    set +e
    nsenter --target "$SUB_NS_HOST_PID" --pid --mount --root --wd=/ -- \
        /usr/sbin/machinen-dump --in-sub-ns "$DUMP_PID"
    nsenter_rc=$?
    set -e

    # Flush the block device — sync covers all pages regardless of
    # which mount namespace dirtied them.
    sync

    # Verify the dump landed on disk: mount the scratch in our parent
    # NS (it was unmounted when the sub-NS died) and look for CRIU
    # core images. nsenter_rc is unreliable here — exit 137 (SIGKILL)
    # is normal when the sub-NS dies on us, but exit 0 also happens
    # if our re-exec'd self finishes cleanup before the SIGKILL lands.
    mkdir -p /mnt/snap
    if ! mount "$SCRATCH" /mnt/snap 2>/dev/null; then
        echo "machinen-dump: chained dump — couldn't mount $SCRATCH to verify (nsenter rc=$nsenter_rc)" >&2
        exit 1
    fi
    if ! ls /mnt/snap/img/core-*.img >/dev/null 2>&1; then
        echo "machinen-dump: chained CRIU dump failed (nsenter rc=$nsenter_rc) — tail of dump.log:" >&2
        tail -40 /mnt/snap/img/dump.log 2>/dev/null >&2 || echo "(no dump.log)" >&2
        exit 1
    fi
    sync
    umount /mnt/snap
    sync
    exit 0
fi

# CRIU's kerndat_tcp_repair probe fails with ENETUNREACH if `lo` is
# still DOWN. /init doesn't bring it up; we do it here so snapshot is
# self-contained. (lo-up is idempotent and the network NS is shared
# with the parent, so this is a no-op when we're inside the sub-NS.)
/sbin/machinen-lo-up || {
    echo "machinen-dump: lo-up failed" >&2
    exit 1
}

# CRIU's kerndat_has_move_mount_set_group probe creates a throwaway dir
# under /tmp (`/tmp/.criu.move_mount_set_group.XXXXXX`); a rootfs with
# no /tmp (older app.tar.gz layers, minimal images) makes it fail with
# ENOENT and aborts the dump before it touches the workload. The base
# rootfs ships /tmp, but be defensive in case a layered image stripped it.
mkdir -p /tmp
chmod 1777 /tmp 2>/dev/null || true

# Drop the read-only bundle mount in our current NS.
# /sbin/machinen-restore mounts the bundle's images at /mnt/snap-src
# (read-only) and doesn't unmount when restore returns. The parent
# bundle's images aren't needed for the running workload; clear the
# mount so the kernel will let us re-mount $SCRATCH at /mnt/snap
# (mkfs.ext4 -F refuses if the device is mounted anywhere visible).
if mountpoint -q /mnt/snap-src 2>/dev/null; then
    umount /mnt/snap-src 2>/dev/null || umount -l /mnt/snap-src
fi

# Format the scratch disk ext4 on first use. Subsequent snapshots just
# remount and `rm -rf /mnt/snap/img` below clears any prior images
# (including the parent bundle's, on chained snapshots).
# -F: force (existing data is a scratch allocation; we're overwriting).
# -q: quiet; noisy output confuses the host-side log tee.
if ! blkid "$SCRATCH" 2>/dev/null | grep -q ext4; then
    echo "machinen-dump: formatting $SCRATCH as ext4"
    mkfs.ext4 -F -q "$SCRATCH"
fi
mkdir -p /mnt/snap
mount "$SCRATCH" /mnt/snap

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
#
# In the chained-restore case (--in-sub-ns), the same chain works: criu
# dump kills the dumped tree → criu_restore's wait returns → criu_restore
# exits → /sbin/machinen-restore unblocks → /sbin/machinen-poweroff.
# Our process here may be SIGKILLed by the kernel's pid_ns destruction
# before this exit fires (we're a process inside the dying sub-NS), but
# the data has already been flushed to the block device above.
exit 0
