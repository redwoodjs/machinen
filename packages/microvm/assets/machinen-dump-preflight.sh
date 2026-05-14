#!/bin/sh
# /sbin/machinen-dump-preflight — pre-flight checks run by
# /sbin/machinen-dump before it hands off to `criu dump`. Lives in its
# own file so the logic can be unit-tested against a synthetic /proc
# tree without booting a VM (see dump-preflight.test.ts).
#
# Sourceable + executable:
#   - sourced from machinen-dump.sh (defines the function, no side
#     effects from the body),
#   - or invoked directly: `machinen-dump-preflight <root-pid>` runs
#     the function and exits with its status — that's the path the
#     unit test exercises.
#
# Both paths read /proc by default. Tests override via $PROC.

# Refuse to dump trees that hold ICMP sockets — both SOCK_RAW (any
# IPPROTO_*) and SOCK_DGRAM (the "unprivileged ping" path,
# IPPROTO_ICMP{,V6}). CRIU 3.17.1 (Debian 12's package) rejects both
# in `can_dump_ipproto` (criu/sk-inet.c:128) with "Unsupported proto N
# for socket M": SOCK_RAW with non-{IP,TCP,UDP,UDPLITE} fails the
# proto switch, and SOCK_DGRAM IPPROTO_ICMP fails for the same reason
# because IPPROTO_ICMP isn't in 3.17.1's allowed set. Upstream master
# added IPPROTO_ICMP/ICMPV6 to the switch, but the Debian build we
# ship doesn't have that yet, so we have to be conservative.
#
# `machinen-netup` widens net.ipv4.ping_group_range at boot so
# iputils-ping uses SOCK_DGRAM IPPROTO_ICMP by default (#203). That
# means a workload that ran `ping` and held the socket open is the
# common trigger for the failure mode this guard catches.
#
# Catch the offenders up front and emit a pid+fd+ipproto line so the
# user can find and close the fd. Both SOCK_RAW and SOCK_DGRAM ICMP
# variants surface here.
scan_raw_inet_sockets() {
    root=$1
    proc=${PROC:-/proc}

    # BFS the descendant tree using /proc/<pid>/task/<pid>/children —
    # the kernel's authoritative list of immediate children, so we
    # don't have to scan all of /proc and parse PPIDs out of stat.
    pids="$root"
    frontier="$root"
    while [ -n "$frontier" ]; do
        next=""
        for p in $frontier; do
            if [ -r "$proc/$p/task/$p/children" ]; then
                kids=$(cat "$proc/$p/task/$p/children" 2>/dev/null) || kids=""
                for k in $kids; do
                    pids="$pids $k"
                    next="$next $k"
                done
            fi
        done
        frontier=$next
    done

    bad=""
    for pid in $pids; do
        [ -d "$proc/$pid/fd" ] || continue
        # Per-pid net view in case anything in the tree unshare'd a
        # network namespace; raw sockets there wouldn't appear in the
        # init netns's /proc/net/raw.
        #
        # /proc/net/{raw,raw6}  → SOCK_RAW; col 2's right half is the
        #                          IPPROTO_*. CRIU rejects all of these.
        # /proc/net/{icmp,icmp6} → SOCK_DGRAM IPPROTO_ICMP{,V6}
        #                          ("unprivileged ping"); CRIU 3.17.1
        #                          rejects these too. col 2's right
        #                          half is the source port (not proto)
        #                          for icmp{,6}, so we hardcode the
        #                          proto in the map.
        map=""
        for f in "$proc/$pid/net/raw" "$proc/$pid/net/raw6"; do
            [ -r "$f" ] || continue
            entries=$(awk 'NR>1 { split($2,a,":"); printf "%s %s\n", $10, a[2] }' "$f")
            [ -n "$entries" ] && map="$map
$entries"
        done
        # icmp = 1 (0x01), icmp6 = 58 (0x3A). Hex to match the raw-side
        # encoding so the consumer below can treat both maps uniformly.
        if [ -r "$proc/$pid/net/icmp" ]; then
            entries=$(awk 'NR>1 { printf "%s 0001\n", $10 }' "$proc/$pid/net/icmp")
            [ -n "$entries" ] && map="$map
$entries"
        fi
        if [ -r "$proc/$pid/net/icmp6" ]; then
            entries=$(awk 'NR>1 { printf "%s 003A\n", $10 }' "$proc/$pid/net/icmp6")
            [ -n "$entries" ] && map="$map
$entries"
        fi
        [ -z "$map" ] && continue

        for fd in "$proc/$pid"/fd/*; do
            [ -L "$fd" ] || continue
            tgt=$(readlink "$fd" 2>/dev/null) || continue
            case "$tgt" in
                "socket:["*"]")
                    inode=${tgt#socket:\[}
                    inode=${inode%\]}
                    hex=$(printf '%s\n' "$map" | awk -v i="$inode" '$1==i {print $2; exit}')
                    if [ -n "$hex" ]; then
                        proto=$(printf '%d' "0x$hex" 2>/dev/null) || proto="0x$hex"
                        bad="$bad
  pid=$pid fd=${fd##*/} ipproto=$proto"
                    fi
                    ;;
            esac
        done
    done

    if [ -n "$bad" ]; then
        cat >&2 <<EOF
machinen-dump: workload holds ICMP/raw IP socket(s) — CRIU 3.17.1
  rejects these in can_dump_ipproto (sk-inet.c:128) and the dump
  would fail with "Unsupported proto N":$bad
machinen-dump: close the offending fd(s) before snapshot. iputils-ping
  uses SOCK_DGRAM/IPPROTO_ICMP via ping_group_range (#203); a recent
  \`ping\` whose socket is still open is the common trigger.
EOF
        return 1
    fi
    return 0
}

# When invoked directly (not sourced), run every check against $1.
# dash doesn't expose `BASH_SOURCE`, so we use the convention of
# comparing $0's basename — when sourced, $0 is whatever sourced us.
#
# Each check is independent and runs unconditionally so the operator
# sees the full set of blockers in one shot, not a fail-fast cascade.
# Aggregate exit is non-zero iff any check failed.
#
# (#338 removed FUSE-over-vsock live mounts, so there's no
# unmount-before-dump step here anymore — virtio-fs live mounts are
# served by an in-VMM device and need no guest-side teardown.)
case "${0##*/}" in
    machinen-dump-preflight|machinen-dump-preflight.sh)
        if [ "$#" -ne 1 ]; then
            echo "usage: machinen-dump-preflight <root-pid>" >&2
            exit 2
        fi
        rc=0
        scan_raw_inet_sockets "$1" || rc=$?
        exit $rc
        ;;
esac
