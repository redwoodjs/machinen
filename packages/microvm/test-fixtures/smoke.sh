#!/usr/bin/env bash
# Integration smoke tests for the microVM.
#
# Runs end-to-end checks against the built VMM:
#
#   repl   Boot with Node.js as init, pipe `1+1` + `.exit`, assert the
#          guest evaluated the expression and started a real Node REPL.
#   criu   Boot with the CRIU fork demo, assert the counter after
#          restore is greater than the counter at dump time.
#   net    Boot, load virtio modules, assert eth0 appears and the
#          kernel's virtio-net driver bound to our virtio-MMIO device.
#
# Prints pass/fail per check and exits non-zero if any fail. Writes
# full guest-console logs to /tmp/microvm-smoke-*.log for post-mortems.
#
# Usage: ./test-fixtures/smoke.sh [repl|criu|net|all]   (default: all)
#
# These require an Apple Silicon host with the HVF entitlement setup.
# They aren't wired into `zig build test` because they depend on
# packed initramfs + kernel fixtures and take ~20s each.

set -euo pipefail

MODE=${1:-all}
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"

FIXTURES=$HERE/test-fixtures
ROOTFS=$FIXTURES/rootfs

for f in "$FIXTURES/Image" "$FIXTURES/virt.dtb"; do
    [[ -f "$f" ]] || { echo "FAIL: missing fixture: $f" >&2; exit 1; }
done
[[ -d "$ROOTFS" ]] || { echo "FAIL: missing $ROOTFS" >&2; exit 1; }

# Strip ANSI color codes and CRs so grep can match plain text.
strip_tty() { sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g; s/\r$//'; }

# Build once, find the binary that contains the boot test.
build_and_find_bin() {
    zig build test >/dev/null 2>&1 || true
    for f in $(ls -t .zig-cache/o/*/test 2>/dev/null); do
        if strings "$f" 2>/dev/null | grep -q MACHINEN_BOOT_TEST; then
            echo "$f"
            return 0
        fi
    done
    return 1
}
TEST_BIN=$(build_and_find_bin) || { echo "FAIL: no boot-test binary" >&2; exit 1; }

# Repack the initramfs with the given demo.sh. `stage` is a shell
# command that sets up $ROOTFS (paths are absolute).
repack_with() {
    local stage_cmd=$1
    eval "$stage_cmd"
    python3 "$FIXTURES/mkinitramfs.py" --rootfs "$ROOTFS" >/dev/null
}

# Run the VMM with the given stdin feed; kill it after a timeout; return
# the stripped log.
run_vmm() {
    local feed=$1 timeout_s=$2 log=$3
    eval "$feed" | MACHINEN_BOOT_TEST=1 "$TEST_BIN" 2>"$log" &
    local vm_pid=$!
    local elapsed=0
    while kill -0 $vm_pid 2>/dev/null; do
        (( elapsed += 1 ))
        if (( elapsed >= timeout_s )); then kill -9 $vm_pid 2>/dev/null || true; break; fi
        sleep 1
    done
    wait $vm_pid 2>/dev/null || true
    strip_tty <"$log" >"${log}.clean"
}

PASS=0; FAIL=0
pass() { echo "PASS: $1"; (( ++PASS )); }
fail() { echo "FAIL: $1"; (( ++FAIL )); }

smoke_repl() {
    echo "--- repl ---"
    local log=/tmp/microvm-smoke-repl.log
    repack_with "
        cat > $ROOTFS/demo.sh <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin; export PATH
exec /usr/local/bin/node
SH
        chmod +x $ROOTFS/demo.sh
    "
    run_vmm '{ sleep 12; printf "1 + 1\n.exit\n"; sleep 5; }' 22 "$log"

    grep -q 'Welcome to Node' "${log}.clean"   && pass 'Node REPL banner shown'   || fail 'no Node REPL banner'
    grep -qE '^2$' "${log}.clean"              && pass '1 + 1 evaluated to 2'     || fail '1 + 1 did not print 2'
    grep -q 'Kernel panic' "${log}.clean"     && pass '.exit caused clean exit' || fail '.exit did not exit Node'
}

smoke_criu() {
    echo "--- criu ---"
    local log=/tmp/microvm-smoke-criu.log
    for helper in lo-up no-iou; do
        src=$FIXTURES/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done
    repack_with "
        cp $FIXTURES/counter.js $FIXTURES/fork-demo.sh $ROOTFS/
        chmod +x $ROOTFS/fork-demo.sh
        cat > $ROOTFS/demo.sh <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin; export PATH
exec /bin/sh /fork-demo.sh
SH
        chmod +x $ROOTFS/demo.sh
    "
    run_vmm 'printf ""' 32 "$log"

    # Two 'count file:' lines: one before dump, one after restore.
    local before after
    before=$(grep 'count file:' "${log}.clean" | sed -n '1p' | awk '{print $3}')
    after=$(grep 'count file:' "${log}.clean" | sed -n '3p' | awk '{print $3}')

    grep -q 'dump OK'    "${log}.clean" && pass 'CRIU dump succeeded'    || fail 'CRIU dump did not succeed'
    grep -q 'restore OK' "${log}.clean" && pass 'CRIU restore succeeded' || fail 'CRIU restore did not succeed'

    if [[ -n "$before" && -n "$after" && "$after" -gt "$before" ]]; then
        pass "counter advanced after restore ($before -> $after)"
    else
        fail "counter did not advance (before='$before' after='$after')"
    fi
}

smoke_net() {
    echo "--- net ---"
    local log=/tmp/microvm-smoke-net.log
    # Keep the C helpers built alongside lo-up / no-iou.
    for helper in if-up gw-set; do
        src=$FIXTURES/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done
    repack_with "
        cp $FIXTURES/net-demo.sh $ROOTFS/
        chmod +x $ROOTFS/net-demo.sh
        cat > $ROOTFS/demo.sh <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin; export PATH
exec /bin/sh /net-demo.sh
SH
        chmod +x $ROOTFS/demo.sh
    "
    run_vmm 'printf ""' 22 "$log"

    grep -q '^eth0'                 "${log}.clean" && pass 'eth0 interface present'        || fail 'eth0 not found'
    grep -q 'virtio0 device=0x0001' "${log}.clean" && pass 'virtio-net bound on virtio0'   || fail 'virtio0 not bound to virtio-net'
    grep -q '^if-up ok'             "${log}.clean" && pass 'SIOCSIFFLAGS brought eth0 up'  || fail 'if-up eth0 failed'
    grep -q 'operstate: up'         "${log}.clean" && pass 'operstate reports up'          || fail 'operstate not up'

    # tx_packets after the interface is up: the kernel auto-emits IPv6
    # NDP/MLD as soon as eth0 comes up, so any non-zero here means our
    # TX queue actually drained through notify() and used-ring updates.
    local tx_after
    tx_after=$(sed -n 's/^tx_packets: //p' "${log}.clean" | sed -n '2p')
    if [[ -n "$tx_after" && "$tx_after" -gt 0 ]]; then
        pass "TX queue drained (tx_packets=$tx_after)"
    else
        fail "TX queue did not drain (tx_packets='$tx_after')"
    fi

    # M3 foundation: host read the actual frame bytes out of guest
    # memory and classified them. IPv6 multicast frames are what the
    # kernel auto-emits; any of them hitting the `[tx]` log proves
    # the readout path works, not just the descriptor accounting.
    grep -q '^\[tx\] .* class=ipv6-mcast' "${log}" \
        && pass 'host received IPv6 multicast frames from guest' \
        || fail 'no IPv6-mcast frames captured on host'

    # M3 proper: libslirp resolves DNS and a TCP fetch returns a 200.
    # Asserts real packet flow both directions through our virtqueues.
    grep -q 'dns: example.com ->' "${log}.clean" \
        && pass 'DNS resolved via slirp' \
        || fail 'DNS did not resolve through slirp'
    grep -q 'first line: HTTP/1.1 200 OK' "${log}.clean" \
        && pass 'TCP+HTTP round trip via slirp' \
        || fail 'HTTP GET did not return 200'
}

case "$MODE" in
    repl) smoke_repl ;;
    criu) smoke_criu ;;
    net)  smoke_net ;;
    all)  smoke_repl; smoke_criu; smoke_net ;;
    *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac

echo
echo "summary: $PASS passed, $FAIL failed"
exit $(( FAIL == 0 ? 0 : 1 ))
