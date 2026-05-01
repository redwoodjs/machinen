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

# Refuse to dump trees that hold raw IP sockets. CRIU has no encoder
# for SOCK_RAW of any IPPROTO_* (sk-inet.c rejects with "Unsupported
# proto N for socket M" deep in the dumper, which is unactionable
# without reading the source). Catch them up front and emit a
# pid+fd+ipproto line so the user can find and close the offending fd.
#
# Unprivileged ping sockets (SOCK_DGRAM / IPPROTO_ICMP) live in
# /proc/net/icmp{,6} and are explicitly NOT scanned — CRIU 3.17+
# supports those, and machinen-netup widens net.ipv4.ping_group_range
# at boot so iputils-ping uses that path by default (#203).
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
        map=""
        for f in "$proc/$pid/net/raw" "$proc/$pid/net/raw6"; do
            [ -r "$f" ] || continue
            entries=$(awk 'NR>1 { split($2,a,":"); printf "%s %s\n", $10, a[2] }' "$f")
            [ -n "$entries" ] && map="$map
$entries"
        done
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
machinen-dump: workload holds raw IP socket(s) — CRIU has no encoder
  for SOCK_RAW and the dump would fail with "Unsupported proto N":$bad
machinen-dump: close the offending fd(s) before snapshot. The
  unprivileged ping path (SOCK_DGRAM / IPPROTO_ICMP) IS supported —
  use it instead of SOCK_RAW where possible.
EOF
        return 1
    fi
    return 0
}

# When invoked directly (not sourced), run the scan against $1. dash
# doesn't expose `BASH_SOURCE`, so we use the convention of comparing
# $0's basename — when sourced, $0 is whatever sourced us.
case "${0##*/}" in
    machinen-dump-preflight|machinen-dump-preflight.sh)
        if [ "$#" -ne 1 ]; then
            echo "usage: machinen-dump-preflight <root-pid>" >&2
            exit 2
        fi
        scan_raw_inet_sockets "$1"
        exit $?
        ;;
esac
