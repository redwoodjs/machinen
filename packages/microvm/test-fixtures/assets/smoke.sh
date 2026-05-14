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
#   net-bench  Boot, run 100 TCP ping-pongs against a host echo server
#          through slirp's vhost NAT (10.0.2.2), report μs-per-ping (#82).
#   node-http  Boot with a Node HTTP server listening on :3000, install
#          a host->guest forward via gvproxy's control API, assert
#          curl on 127.0.0.1:<host_port> returns 200 + expected body
#          (#87).
#
# Prints pass/fail per check and exits non-zero if any fail. Writes
# full guest-console logs to /tmp/microvm-smoke-*.log for post-mortems.
#
# Usage: ./test-fixtures/assets/smoke.sh [repl|criu|net|net-bench|node-http|all]   (default: all)
#
# These require an Apple Silicon host with the HVF entitlement setup.
# They aren't wired into `zig build test` because they depend on
# packed initramfs + kernel fixtures and take ~20s each.

set -euo pipefail

MODE=${1:-all}
HERE=$(cd "$(dirname "$0")/../.." && pwd)
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
# grep -aq treats binary files as text and avoids the pipefail+SIGPIPE
# flake that a `strings | grep -q` pipe trips on large binaries.
build_and_find_bin() {
    zig build test >/dev/null 2>&1 || true
    for f in $(ls -t .zig-cache/o/*/test 2>/dev/null); do
        if LC_ALL=C grep -aq MACHINEN_BOOT_TEST "$f" 2>/dev/null; then
            echo "$f"
            return 0
        fi
    done
    return 1
}
TEST_BIN=$(build_and_find_bin) || { echo "FAIL: no boot-test binary" >&2; exit 1; }

# Repack the initramfs. `stage` is a shell command that sets up
# $ROOTFS (paths are absolute). Optional second arg is extra flags
# to mkinitramfs.ts (e.g. `--exclude-from FILE`). Nukes any prior
# machinen-config.json / demo.sh so each mode starts clean.
repack_with() {
    local stage_cmd=$1
    local extra=${2:-}
    rm -f "$ROOTFS/machinen-config.json" "$ROOTFS/demo.sh"
    eval "$stage_cmd"
    # shellcheck disable=SC2086  # extra is intentional flag-splitting.
    node --import tsx "$FIXTURES/assets/mkinitramfs.ts" --rootfs "$ROOTFS" $extra >/dev/null
}

# Write $ROOTFS/machinen-config.json with the positional args as argv.
# Matches the PATH/NODE_NO_WARNINGS/HOME env the old /demo.sh fallback
# set; TERM=linux is auto-added by /init.
write_config() {
    local cmd_json=""
    for a in "$@"; do
        [[ -n "$cmd_json" ]] && cmd_json+=", "
        cmd_json+="\"$a\""
    done
    cat > "$ROOTFS/machinen-config.json" <<EOF
{
  "cmd": [$cmd_json],
  "env": {
    "PATH": "/usr/local/bin:/usr/bin:/bin:/sbin",
    "NODE_NO_WARNINGS": "1",
    "HOME": "/root"
  }
}
EOF
}

# Run the VMM with the given stdin feed; kill it after a timeout; return
# the stripped log.
run_vmm() {
    local feed=$1 timeout_s=$2 log=$3
    # Smokes scrape [tx] lines and diagnostic prints, so leave the
    # debug channel on. Interactive try.sh boots leave it off.
    eval "$feed" | MACHINEN_DEBUG=1 MACHINEN_BOOT_TEST=1 "$TEST_BIN" 2>"$log" &
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
    repack_with "write_config /usr/local/bin/node"
    run_vmm '{ sleep 14; printf "1 + 1\n.exit\n"; sleep 5; }' 28 "$log"

    grep -q 'Welcome to Node' "${log}.clean"   && pass 'Node REPL banner shown'   || fail 'no Node REPL banner'
    grep -qE '^2$' "${log}.clean"              && pass '1 + 1 evaluated to 2'     || fail '1 + 1 did not print 2'
    grep -q 'Kernel panic' "${log}.clean"     && pass '.exit caused clean exit' || fail '.exit did not exit Node'
}

smoke_criu() {
    echo "--- criu ---"
    local log=/tmp/microvm-smoke-criu.log
    for helper in lo-up no-iou; do
        src=$FIXTURES/assets/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done
    repack_with "
        cp $FIXTURES/assets/counter.js $FIXTURES/assets/fork-demo.sh $ROOTFS/
        chmod +x $ROOTFS/fork-demo.sh
        write_config /bin/sh /fork-demo.sh
    "
    run_vmm 'printf ""' 50 "$log"

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
        src=$FIXTURES/assets/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done
    repack_with "
        cp $FIXTURES/assets/net-demo.sh $ROOTFS/
        chmod +x $ROOTFS/net-demo.sh
        write_config /bin/sh /net-demo.sh
    "

    # Stand up gvproxy so the guest has somewhere to talk. If it isn't
    # installed, skip the traffic-asserting portion of the test — the
    # virtio wiring checks can still run without a backend.
    local gv_pid="" gv_sock=""
    if command -v gvproxy >/dev/null; then
        gv_sock=$(mktemp -u /tmp/machinen-gv.XXXXXX.sock)
        gvproxy -listen-qemu "unix://$gv_sock" >/tmp/microvm-smoke-gvproxy.log 2>&1 &
        gv_pid=$!
        # Wait (up to ~2s) for the socket to appear.
        for _ in $(seq 1 40); do
            [[ -S "$gv_sock" ]] && break
            sleep 0.05
        done
        if [[ ! -S "$gv_sock" ]]; then
            echo "  skip: gvproxy did not create $gv_sock; running net smoke without a backend"
            kill "$gv_pid" 2>/dev/null || true
            gv_pid=""
        else
            export MACHINEN_NET_SOCKET="$gv_sock"
        fi
    else
        echo "  note: gvproxy not on PATH; running net smoke without a backend"
    fi

    run_vmm 'printf ""' 40 "$log"

    # Tear gvproxy down regardless of outcome.
    if [[ -n "$gv_pid" ]]; then
        kill "$gv_pid" 2>/dev/null || true
        unset MACHINEN_NET_SOCKET
        rm -f "$gv_sock"
    fi

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

    # Foundation: host read the actual frame bytes out of guest memory
    # and classified them. IPv6 multicast frames are what the kernel
    # auto-emits; any of them hitting the `[tx]` log proves the readout
    # path works, not just the descriptor accounting.
    grep -q '^\[tx\] .* class=ipv6-mcast' "${log}" \
        && pass 'host received IPv6 multicast frames from guest' \
        || fail 'no IPv6-mcast frames captured on host'

    # Traffic assertions only run when gvproxy was running — without a
    # backend the frames have nowhere to go and DNS/HTTP won't resolve.
    if [[ -n "$gv_pid" ]]; then
        grep -q 'dns: example.com ->' "${log}.clean" \
            && pass 'DNS resolved via gvproxy' \
            || fail 'DNS did not resolve through gvproxy'
        grep -q 'first line: HTTP/1.1 200 OK' "${log}.clean" \
            && pass 'TCP+HTTP round trip via gvproxy' \
            || fail 'HTTP GET did not return 200'
    else
        echo "  skip: DNS + HTTP assertions (no gvproxy backend)"
    fi
}

# #82: measures guest -> host-loopback TCP round-trip latency through
# gvproxy. The host runs a trivial python3 echo server bound to
# 127.0.0.1; the guest connects via gvproxy's host mapping
# (192.168.127.254, which gvproxy proxies to host loopback) and runs
# /sbin/machinen-net-bench-probe for 100 sequential 1-byte ping-pongs.
# Informational only — records a baseline number, doesn't gate.
smoke_net_bench() {
    echo "--- net-bench ---"
    local log=/tmp/microvm-smoke-net-bench.log
    local port=38080
    local echo_pid_file=/tmp/machinen-net-bench-echo.pid

    if ! command -v gvproxy >/dev/null; then
        echo "  skip: gvproxy not on PATH; net-bench requires a network backend"
        return
    fi
    if lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
        fail "net-bench: port $port already in use on host"
        return
    fi

    # Host-side TCP echo server on 127.0.0.1. One connection, echoes
    # bytes back as they arrive, exits when the guest closes.
    python3 - "$port" <<'PY' &
import socket, sys
port = int(sys.argv[1])
srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", port))
srv.listen(1)
srv.settimeout(60)
try:
    conn, _ = srv.accept()
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    with conn:
        while True:
            data = conn.recv(4096)
            if not data:
                break
            conn.sendall(data)
except socket.timeout:
    pass
finally:
    srv.close()
PY
    local echo_pid=$!
    echo "$echo_pid" > "$echo_pid_file"

    # Wait for bind.
    local elapsed=0
    while (( elapsed < 10 )); do
        if lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
            break
        fi
        sleep 1; (( ++elapsed ))
    done
    if (( elapsed >= 10 )); then
        kill -9 "$echo_pid" 2>/dev/null || true
        rm -f "$echo_pid_file"
        fail "net-bench: host echo server never bound 127.0.0.1:$port"
        return
    fi

    # Spawn gvproxy so the guest has a network backend. Same pattern
    # as smoke_net above.
    local gv_sock=""
    gv_sock=$(mktemp -u /tmp/machinen-gv.XXXXXX.sock)
    gvproxy -listen-qemu "unix://$gv_sock" >/tmp/microvm-smoke-gvproxy-bench.log 2>&1 &
    local gv_pid=$!
    for _ in $(seq 1 40); do
        [[ -S "$gv_sock" ]] && break
        sleep 0.05
    done
    if [[ ! -S "$gv_sock" ]]; then
        kill "$gv_pid" 2>/dev/null || true
        kill -9 "$echo_pid" 2>/dev/null || true
        rm -f "$echo_pid_file"
        fail "net-bench: gvproxy did not create $gv_sock"
        return
    fi
    export MACHINEN_NET_SOCKET="$gv_sock"

    # Compile the probe if missing / stale. Mirrors the if-up/gw-set
    # on-demand build in smoke_net.
    local probe_src=$FIXTURES/../assets/net-bench-probe.zig
    local probe_bin=$ROOTFS/sbin/machinen-net-bench-probe
    if [[ ! -x "$probe_bin" || "$probe_src" -nt "$probe_bin" ]]; then
        mkdir -p "$ROOTFS/sbin"
        zig build-exe "$probe_src" \
            -target aarch64-linux-musl -static -O ReleaseSmall \
            -lc -femit-bin="$probe_bin" >/dev/null 2>&1
        rm -f "$probe_bin.o"
    fi

    repack_with "
        cp $FIXTURES/assets/net-bench-demo.sh $ROOTFS/
        chmod +x $ROOTFS/net-bench-demo.sh
        write_config /bin/sh /net-bench-demo.sh
    "
    # 100 pings at sub-ms RTT ≈ 0.1s. Plus boot/teardown ~8s. 30s
    # headroom covers the worst case if something stalls.
    run_vmm 'printf ""' 30 "$log"

    kill "$gv_pid" 2>/dev/null || true
    unset MACHINEN_NET_SOCKET
    rm -f "$gv_sock"
    kill -9 "$echo_pid" 2>/dev/null || true
    rm -f "$echo_pid_file"

    local line
    line=$(grep '^net-bench: pings=' "${log}.clean" | head -1)
    if [[ -z "$line" ]]; then
        fail 'guest never reported net-bench latency (see log)'
        return
    fi
    pass "$line"

    # Informational baseline — no asserted ceiling. The `pass` line
    # above documents the measurement.
}

smoke_blk() {
    echo "--- blk ---"
    local log=/tmp/microvm-smoke-blk.log
    local disk=$FIXTURES/disk.img

    # Fresh 4 MiB image with a known marker at offset 0.
    dd if=/dev/zero of="$disk" bs=1m count=4 >/dev/null 2>&1
    printf 'MACHINEN_VDA_MARKER hello from host disk\n' \
        | dd of="$disk" conv=notrunc bs=1 count=41 >/dev/null 2>&1

    repack_with "
        cp $FIXTURES/assets/blk-demo.sh $ROOTFS/
        chmod +x $ROOTFS/blk-demo.sh
        write_config /bin/sh /blk-demo.sh
    "
    run_vmm 'printf ""' 40 "$log"

    grep -q 'virtio1 device=0x0002'             "${log}.clean" && pass 'virtio-blk device on virtio1' || fail 'virtio-blk device missing'
    grep -q 'size bytes: 8192'                  "${log}.clean" && pass 'guest sees 4 MiB of sectors' || fail 'capacity wrong'
    grep -q 'MACHINEN_VDA_MARKER'               "${log}.clean" && pass 'guest read host marker from /dev/vda' || fail 'host->guest read failed'
    grep -q 'MACHINEN_GUEST_WROTE_THIS'         "${log}.clean" && pass 'guest read back its own write via /dev/vda' || fail 'guest write->read round trip failed'

    # And check the write reached the host file too.
    if grep -qa MACHINEN_GUEST_WROTE_THIS "$disk"; then
        pass 'write persisted into host disk.img'
    else
        fail 'write did not reach host file'
    fi
}

smoke_cc() {
    echo "--- cc ---"
    local log=/tmp/microvm-smoke-cc.log
    repack_with "
        cp $FIXTURES/assets/cc-demo.sh $ROOTFS/
        chmod +x $ROOTFS/cc-demo.sh
        write_config /bin/sh /cc-demo.sh
    "
    run_vmm 'printf ""' 30 "$log"

    grep -q '/usr/local/bin/claude'       "${log}.clean" && pass 'claude binary is on the guest PATH' || fail 'claude not found on PATH'
    grep -qE '[0-9]+\.[0-9]+\.[0-9]+ \(Claude Code\)' "${log}.clean" \
        && pass 'claude --version runs inside the guest' \
        || fail 'claude --version did not produce a version string'
    grep -qE '^v[0-9]+' "${log}.clean" && pass 'node --version runs inside the guest' || fail 'node --version failed'
}

smoke_spawn() {
    echo "--- spawn ---"
    local p1_log=/tmp/microvm-smoke-spawn-warmup.log
    local p2_log=/tmp/microvm-smoke-spawn-restore.log
    local disk=$FIXTURES/disk.img
    # Drop Claude Code, npm, yarn, udev, most kernel driver modules —
    # none are touched by spawn-warmup.sh / spawn-restore.sh. Combined
    # with the DTB initrd-end patch in src/boot_hvf.zig (kernel scans the
    # initrd window for concatenated archives at ~1 GB/s wall-clock),
    # this drives `spawn → restore OK` under a second. See #50.
    local slim="--exclude-from $FIXTURES/assets/spawn-minimal.excludes"

    # Fresh 128 MiB raw disk. spawn-warmup.sh formats it ext4
    # inside the guest on first boot.
    dd if=/dev/zero of="$disk" bs=1m count=128 >/dev/null 2>&1

    # Phase 1: warmup boot — runs counter, dumps onto /dev/vda.
    repack_with "
        cp $FIXTURES/assets/spawn-warmup.sh $FIXTURES/assets/spawn-restore.sh $ROOTFS/
        chmod +x $ROOTFS/spawn-warmup.sh $ROOTFS/spawn-restore.sh
        write_config /bin/sh /spawn-warmup.sh
    " "$slim"
    run_vmm 'printf ""' 45 "$p1_log"

    grep -q 'dump OK' "${p1_log}.clean" && pass 'warmup: CRIU dump OK' || fail 'warmup: dump failed'

    # Pull the snapshot count out of phase 1 so phase 2 can assert
    # monotonicity.
    local before
    before=$(grep 'snap/count:' "${p1_log}.clean" | sed -n '1p' | awk '{print $2}')
    echo "counter at dump: $before"

    # Phase 2: restore boot — same disk, point /init at the restore
    # script. Same slim exclude list; the restore path uses the same
    # tools as warmup.
    repack_with "write_config /bin/sh /spawn-restore.sh" "$slim"
    run_vmm 'printf ""' 40 "$p2_log"

    grep -q 'restore OK' "${p2_log}.clean" && pass 'restore: CRIU restore OK' || fail 'restore: failed'

    # Last snap/count line on phase 2 should be strictly greater
    # than `before`.
    local after
    after=$(grep 'snap/count:' "${p2_log}.clean" | tail -1 | awk '{print $2}')
    if [[ -n "$before" && -n "$after" && "$after" =~ ^[0-9]+$ && "$after" -gt "$before" ]]; then
        pass "counter advanced across VMM restarts ($before -> $after)"
    else
        fail "counter did not advance (before='$before' after='$after')"
    fi
}

smoke_cc_session() {
    echo "--- cc-session ---"
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "SKIP: ANTHROPIC_API_KEY not set in host env"
        return 0
    fi
    local log=/tmp/microvm-smoke-cc-session.log
    # Same helper chain as the net smoke (if-up, gw-set, no-iou, lo-up).
    for helper in if-up gw-set; do
        src=$FIXTURES/assets/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done
    mkdir -p "$ROOTFS/etc"
    # Injecting a live key into the initramfs — secrets-in-image is
    # fine for a single-tenant sandbox, not fine for anything shared.
    # The long-term fix is injecting per-boot via cpio concat or a
    # host-side agent over vsock (#44).
    printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" > "$ROOTFS/etc/machinen.env"
    chmod 600 "$ROOTFS/etc/machinen.env"

    repack_with "
        cp $FIXTURES/assets/cc-session.sh $ROOTFS/
        chmod +x $ROOTFS/cc-session.sh
        write_config /bin/sh /cc-session.sh
    "
    run_vmm 'printf ""' 80 "$log"

    # Wipe the baked key so we don't carry it into other modes' initramfses.
    rm -f "$ROOTFS/etc/machinen.env"

    grep -q 'ANTHROPIC_API_KEY set'  "${log}.clean" && pass 'key reached the guest'    || fail 'key missing in guest'
    # Any of: a real `pong` reply, a CC status line, or an HTTP error
    # that isn't "couldn't connect" all prove the sandbox reached the
    # API. We accept the broad set because live API flakiness is a
    # poor CI signal; a hard-assert on "pong" will fail intermittently.
    if grep -qiE 'pong|rate[-_ ]?limit|authentication|anthropic|usage|invoke|model|credit|quota|error' "${log}.clean"; then
        pass 'guest reached api.anthropic.com (got a model-layer response)'
    else
        fail 'no Claude API response seen in guest console'
    fi
}

smoke_vsock() {
    echo "--- vsock ---"
    local log=/tmp/microvm-smoke-vsock.log
    local sock=/tmp/machinen-smoke-vsock.sock
    rm -f "$sock"
    repack_with "
        cp $FIXTURES/assets/vsock-demo.sh $ROOTFS/vsock-demo.sh
        chmod +x $ROOTFS/vsock-demo.sh
        write_config /bin/sh /vsock-demo.sh
    "
    MACHINEN_VSOCK="1234:$sock" MACHINEN_BOOT_TEST=1 "$TEST_BIN" </dev/null 2>"$log" &
    local vm_pid=$!
    # Wait up to 30s for the guest echo server to report ready.
    local elapsed=0
    local ready=0
    while (( elapsed < 30 )); do
        if grep -q 'vsock-demo: listening' "$log" 2>/dev/null; then ready=1; break; fi
        sleep 1; (( ++elapsed ))
    done
    if (( ready == 0 )); then
        fail 'guest never reported vsock-demo: listening'
        kill -9 $vm_pid 2>/dev/null || true
        wait $vm_pid 2>/dev/null || true
        return
    fi
    # Round-trip "hello-vsock" via the UDS.
    local got
    got=$(python3 - "$sock" <<'PY' 2>/dev/null
import socket, sys, time
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sys.argv[1])
msg = b"hello-vsock\n"
s.sendall(msg)
s.settimeout(5)
data = b""
t0 = time.time()
while time.time() - t0 < 5 and len(data) < len(msg):
    try:
        chunk = s.recv(4096)
        if not chunk: break
        data += chunk
    except socket.timeout: break
sys.stdout.buffer.write(data)
PY
)
    kill -9 $vm_pid 2>/dev/null || true
    wait $vm_pid 2>/dev/null || true
    rm -f "$sock"
    # Command substitution strips trailing newlines, so compare without.
    if [[ "$got" == "hello-vsock" ]]; then
        pass 'UDS <-> guest AF_VSOCK round-trip'
    else
        fail "UDS round-trip returned '$got' (expected 'hello-vsock')"
    fi
    strip_tty <"$log" >"${log}.clean"
    grep -qE 'vsock: in [0-9]+ <->' "${log}" && pass 'vsock bridge reported an inbound port' || fail 'vsock bridge never reported inbound mapping'
}

smoke_cc_session_vsock() {
    echo "--- cc-session-vsock (API key via vsock, no bake) ---"
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
        echo "SKIP: ANTHROPIC_API_KEY not set in host env"
        return 0
    fi
    local log=/tmp/microvm-smoke-cc-session-vsock.log
    local sock=/tmp/machinen-cc-secrets.sock
    rm -f "$sock"
    # Same C helper chain as smoke_cc_session — needed for the net
    # path that reaches api.anthropic.com.
    for helper in if-up gw-set; do
        src=$FIXTURES/assets/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done
    # Critical: do NOT bake the key. That's the entire point.
    rm -f "$ROOTFS/etc/machinen.env"

    repack_with "
        cp $FIXTURES/assets/cc-session.sh $ROOTFS/cc-session.sh
        cp $FIXTURES/secrets-agent $ROOTFS/secrets-agent
        chmod +x $ROOTFS/secrets-agent
        cp $FIXTURES/assets/cc-session-vsock-demo.sh $ROOTFS/cc-session-vsock-demo.sh
        chmod +x $ROOTFS/cc-session.sh $ROOTFS/cc-session-vsock-demo.sh
        write_config /bin/sh /cc-session-vsock-demo.sh
    "

    MACHINEN_VSOCK="in:1975:$sock" MACHINEN_DEBUG=1 MACHINEN_BOOT_TEST=1 \
        "$TEST_BIN" </dev/null 2>"$log" &
    local vm_pid=$!
    # Wait up to 40s for the agent to report listening.
    local elapsed=0 ready=0
    while (( elapsed < 40 )); do
        if grep -q 'secrets-agent: listening' "$log" 2>/dev/null; then ready=1; break; fi
        sleep 1; (( ++elapsed ))
    done
    if (( ready == 0 )); then
        fail 'guest secrets agent never reported listening'
        kill -9 $vm_pid 2>/dev/null || true
        wait $vm_pid 2>/dev/null || true
        tail -30 "$log"
        return
    fi
    # Push the key over the UDS.
    python3 - "$sock" "$ANTHROPIC_API_KEY" <<'PY' || fail 'UDS push failed'
import socket, sys
path, key = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(path)
s.sendall(f"ANTHROPIC_API_KEY={key}\n".encode("ascii"))
s.close()
PY

    # Wait for cc-session to finish its turn (up to 60s after key push).
    elapsed=0
    local done=0
    while (( elapsed < 60 )); do
        if grep -qE '=== done ===|claude exited' "$log" 2>/dev/null; then done=1; break; fi
        sleep 2; (( elapsed += 2 ))
    done
    kill -9 $vm_pid 2>/dev/null || true
    wait $vm_pid 2>/dev/null || true
    rm -f "$sock"
    strip_tty <"$log" >"${log}.clean"

    grep -q 'secrets-agent: wrote' "${log}.clean" \
        && pass 'guest wrote /etc/machinen.env from vsock' \
        || fail 'guest never reported writing the env file'
    grep -q 'ANTHROPIC_API_KEY set' "${log}.clean" \
        && pass 'cc-session sourced the injected key' \
        || fail 'cc-session could not read the key'
    if grep -qiE 'pong|rate[-_ ]?limit|authentication|anthropic|usage|invoke|model|credit|quota|error' "${log}.clean"; then
        pass 'guest reached api.anthropic.com (got a model-layer response)'
    else
        fail 'no Claude API response seen in guest console'
    fi
    # Make sure the initramfs that remains on disk has NO key in it —
    # this is the security property we want to assert.
    if grep -q 'ANTHROPIC_API_KEY=' "$ROOTFS/etc/machinen.env" 2>/dev/null; then
        fail 'initramfs rootfs still contains /etc/machinen.env with a key'
    else
        pass 'no key baked into the rootfs/initramfs'
    fi
}

smoke_files() {
    echo "--- files (push/pull over vsock) ---"
    local log=/tmp/microvm-smoke-files.log
    local sock=/tmp/machinen-smoke-files.sock
    local src=/tmp/machinen-smoke-files-src
    local out=/tmp/machinen-smoke-files-out
    rm -f "$sock"
    rm -rf "$src" "$out"

    # Populate a source dir: small text files + a 10 KB blob (enough
    # bytes to span multiple vsock RW packets, which is where the
    # original streaming bug — #58 — bit us).
    mkdir -p "$src/subdir"
    printf 'hello from the host\n' > "$src/hello.txt"
    printf 'nested\n' > "$src/subdir/nested.txt"
    dd if=/dev/urandom of="$src/blob.bin" bs=1K count=10 status=none
    local src_hash
    src_hash=$(find "$src" -type f -exec shasum -a 256 {} + | awk '{print $1}' | sort | shasum -a 256 | awk '{print $1}')

    repack_with "
        cp $FIXTURES/file-agent $ROOTFS/file-agent
        chmod +x $ROOTFS/file-agent
        cp $FIXTURES/assets/file-agent-demo.sh $ROOTFS/file-agent-demo.sh
        chmod +x $ROOTFS/file-agent-demo.sh
        write_config /bin/sh /file-agent-demo.sh
    "

    MACHINEN_VSOCK="in:1976:$sock" MACHINEN_DEBUG=1 MACHINEN_BOOT_TEST=1 \
        "$TEST_BIN" </dev/null 2>"$log" &
    local vm_pid=$!
    local elapsed=0 ready=0
    while (( elapsed < 30 )); do
        if grep -q 'file-agent: listening' "$log" 2>/dev/null; then ready=1; break; fi
        sleep 1; (( ++elapsed ))
    done
    if (( ready == 0 )); then
        fail 'file-agent never reported listening'
        kill -9 $vm_pid 2>/dev/null || true
        wait $vm_pid 2>/dev/null || true
        tail -30 "$log"
        return
    fi

    local runtime_entry="$HERE/../runtime/src/index.ts"
    cat > /tmp/push-test.mjs <<EOJS
import { VsockFiles } from '$runtime_entry';
await VsockFiles.push('$sock', '$src', '/stash');
console.log('push OK');
EOJS
    node --import tsx /tmp/push-test.mjs 2>&1 | tail -5

    cat > /tmp/pull-test.mjs <<EOJS
import { VsockFiles } from '$runtime_entry';
try {
  await VsockFiles.pull('$sock', '/stash', '$out');
  console.log('pull OK');
} catch (e) {
  console.log('pull FAILED:', e.message);
}
EOJS
    node --import tsx /tmp/pull-test.mjs 2>&1 | tail -5

    kill -9 $vm_pid 2>/dev/null || true
    wait $vm_pid 2>/dev/null || true
    rm -f "$sock"

    local out_hash
    out_hash=$(find "$out" -type f -exec shasum -a 256 {} + | awk '{print $1}' | sort | shasum -a 256 | awk '{print $1}')

    if [[ "$src_hash" == "$out_hash" ]]; then
        pass 'push → guest → pull round-tripped all files byte-identical'
    else
        fail "content hash mismatch (src=$src_hash out=$out_hash)"
        echo "--- src tree ---"; find "$src" -type f | head
        echo "--- out tree ---"; find "$out" -type f | head
    fi

    local src_bytes out_bytes
    src_bytes=$(wc -c < "$src/blob.bin" | tr -d ' ')
    out_bytes=$(wc -c < "$out/blob.bin" 2>/dev/null | tr -d ' ' || echo 0)
    if [[ "$src_bytes" == "$out_bytes" && "$src_bytes" == "10240" ]]; then
        pass "10 KB binary round-tripped exact byte count ($src_bytes)"
    else
        fail "binary byte-count mismatch (src=$src_bytes out=$out_bytes)"
    fi

    rm -rf "$src" "$out"
    rm -f /tmp/push-test.mjs /tmp/pull-test.mjs
}

smoke_winsize() {
    echo "--- winsize (guest-side TIOCSWINSZ via vsock) ---"
    local log=/tmp/microvm-smoke-winsize.log
    local sock=/tmp/machinen-winsize.sock
    rm -f "$sock"

    repack_with "
        cp $FIXTURES/winsize-agent $ROOTFS/winsize-agent
        chmod +x $ROOTFS/winsize-agent
        cp $FIXTURES/assets/winsize-demo.sh $ROOTFS/winsize-demo.sh
        chmod +x $ROOTFS/winsize-demo.sh
        write_config /bin/sh /winsize-demo.sh
    "

    MACHINEN_VSOCK="in:1974:$sock" MACHINEN_BOOT_TEST=1 "$TEST_BIN" </dev/null 2>"$log" &
    local vm_pid=$!
    # Wait up to 40s for the agent to report listening.
    local elapsed=0 ready=0
    while (( elapsed < 40 )); do
        if grep -q 'winsize-agent: listening' "$log" 2>/dev/null; then ready=1; break; fi
        sleep 1; (( ++elapsed ))
    done
    if (( ready == 0 )); then
        fail 'guest agent never reported listening'
        kill -9 $vm_pid 2>/dev/null || true
        wait $vm_pid 2>/dev/null || true
        tail -30 "$log"
        return
    fi

    # Send two resizes and collect the ack text the agent prints.
    local result
    result=$(python3 - "$sock" <<'PY' 2>/dev/null
import socket, sys, time
path = sys.argv[1]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(path)
s.sendall(b"80 24\n")
time.sleep(0.5)
s.sendall(b"132 50\n")
time.sleep(0.5)
# Read whatever the agent echoed back.
s.settimeout(3)
buf = b""
t0 = time.time()
while time.time() - t0 < 3:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        buf += chunk
    except socket.timeout:
        break
sys.stdout.buffer.write(buf)
PY
)
    # Let the agent's stdout flush through the VMM's PL011 echo.
    sleep 1
    kill -9 $vm_pid 2>/dev/null || true
    wait $vm_pid 2>/dev/null || true
    rm -f "$sock"

    if [[ "$result" == *"ok 80 24"* && "$result" == *"ok 132 50"* ]]; then
        pass 'host resize arrived at the guest agent (both sizes acked)'
    else
        fail "agent ack channel missing expected lines (got '$result')"
    fi

    grep -q 'applied: 80 24 -> /dev/console' "$log" \
        && pass 'guest ioctl(TIOCSWINSZ) succeeded on /dev/console (80x24)' \
        || fail 'no applied 80x24 on /dev/console'
    grep -q 'applied: 132 50 -> /dev/console' "$log" \
        && pass 'guest ioctl(TIOCSWINSZ) succeeded on /dev/console (132x50)' \
        || fail 'no applied 132x50 on /dev/console'
}

smoke_node_http() {
    echo "--- node-http (host->guest port forward) ---"
    local log=/tmp/microvm-smoke-node-http.log
    local host_port=38087
    local guest_port=3000

    if ! command -v gvproxy >/dev/null; then
        echo "  skip: gvproxy not on PATH; node-http requires the control API"
        return
    fi
    if lsof -iTCP:"$host_port" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
        fail "node-http: host port $host_port already in use"
        return
    fi

    # Same C helpers smoke_net brings up — the guest needs eth0 + a
    # default route before it can accept traffic coming from gvproxy.
    for helper in if-up gw-set; do
        src=$FIXTURES/assets/$helper.c
        bin=$ROOTFS/usr/bin/$helper
        if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
            zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
        fi
    done

    # Spawn gvproxy with BOTH listeners: -listen-qemu for the VMM's
    # netdev socket, --listen for the control API we POST to.
    local gv_qemu gv_ctrl
    gv_qemu=$(mktemp -u /tmp/machinen-gv.XXXXXX.sock)
    gv_ctrl=$(mktemp -u /tmp/machinen-gv-ctrl.XXXXXX.sock)
    gvproxy -listen-qemu "unix://$gv_qemu" -listen "unix://$gv_ctrl" \
        >/tmp/microvm-smoke-node-http-gvproxy.log 2>&1 &
    local gv_pid=$!
    for _ in $(seq 1 40); do
        [[ -S "$gv_qemu" && -S "$gv_ctrl" ]] && break
        sleep 0.05
    done
    if [[ ! -S "$gv_qemu" || ! -S "$gv_ctrl" ]]; then
        kill "$gv_pid" 2>/dev/null || true
        fail "node-http: gvproxy did not create both sockets"
        return
    fi

    # POST to the control API: bind 127.0.0.1:host_port on the host,
    # forward to 192.168.127.2:guest_port in the guest.
    local expose_status
    expose_status=$(curl -sS --unix-socket "$gv_ctrl" -o /tmp/microvm-smoke-node-http-expose.out -w '%{http_code}' \
        -X POST http:/unix/services/forwarder/expose \
        -H 'content-type: application/json' \
        -d "{\"local\":\"127.0.0.1:$host_port\",\"remote\":\"192.168.127.2:$guest_port\"}" || echo "curl-err")
    if [[ "$expose_status" != "2"* ]]; then
        kill "$gv_pid" 2>/dev/null || true
        fail "node-http: gvproxy expose failed (status=$expose_status, body=$(cat /tmp/microvm-smoke-node-http-expose.out 2>/dev/null))"
        return
    fi

    # Drop in the server + bring-up sequence. The guest must wire
    # eth0 + default route before node listens, otherwise gvproxy's
    # forwarded connection can't reach the server socket.
    cat > "$ROOTFS/node-http-demo.sh" <<'DEMO'
#!/bin/sh
set -e
# Bring up loopback + eth0 via gvproxy's DHCP (192.168.127.2/24).
ip link set lo up
if-up eth0 192.168.127.2 255.255.255.0
gw-set 192.168.127.1
# Start the server, write a readiness line the harness can grep on.
cat > /server.js <<'JS'
import { createServer } from "node:http";
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from microvm\n");
}).listen(3000, "0.0.0.0", () => {
  console.log("node-http: listening on 0.0.0.0:3000");
});
JS
exec /usr/local/bin/node /server.js
DEMO
    chmod +x "$ROOTFS/node-http-demo.sh"

    repack_with "write_config /bin/sh /node-http-demo.sh"

    # Boot the VMM with the gvproxy qemu-netdev socket.
    MACHINEN_NET_SOCKET="$gv_qemu" MACHINEN_DEBUG=1 MACHINEN_BOOT_TEST=1 \
        "$TEST_BIN" </dev/null >"$log" 2>&1 &
    local vm_pid=$!

    # Wait for the server to report readiness, up to 30s.
    local elapsed=0 ready=0
    while (( elapsed < 30 )); do
        if grep -q 'node-http: listening on 0.0.0.0:3000' "$log" 2>/dev/null; then
            ready=1
            break
        fi
        sleep 1
        (( ++elapsed ))
    done
    if (( ready == 0 )); then
        fail 'node-http: guest never reported server readiness'
        kill -9 "$vm_pid" 2>/dev/null || true
        wait "$vm_pid" 2>/dev/null || true
        kill "$gv_pid" 2>/dev/null || true
        rm -f "$gv_qemu" "$gv_ctrl" "$ROOTFS/node-http-demo.sh"
        tail -50 "$log"
        return
    fi
    pass 'node-http: guest server reported listening'

    # Host-side round trip.
    local body status
    body=$(curl -sS -o /tmp/microvm-smoke-node-http-curl.out -w '%{http_code}' \
        "http://127.0.0.1:$host_port/" || echo "curl-err")
    status=$body
    body=$(cat /tmp/microvm-smoke-node-http-curl.out 2>/dev/null || echo '')

    kill -9 "$vm_pid" 2>/dev/null || true
    wait "$vm_pid" 2>/dev/null || true
    kill "$gv_pid" 2>/dev/null || true
    rm -f "$gv_qemu" "$gv_ctrl" "$ROOTFS/node-http-demo.sh"

    if [[ "$status" == "200" ]]; then
        pass "node-http: curl host:$host_port returned 200"
    else
        fail "node-http: curl status=$status (expected 200)"
    fi
    if [[ "$body" == "hello from microvm" ]]; then
        pass 'node-http: response body matched expected'
    else
        fail "node-http: body='$body' (expected 'hello from microvm')"
    fi
}

smoke_vsock_out() {
    echo "--- vsock-out (guest-initiated) ---"
    local log=/tmp/microvm-smoke-vsock-out.log
    local sock=/tmp/machinen-vsock-out.sock
    local echo_pid_file=/tmp/machinen-vsock-out-echo.pid
    rm -f "$sock"

    # Host-side uppercase echo server — listens on the UDS the bridge
    # will dial when the guest's REQUEST for port 5678 lands.
    python3 - "$sock" <<'PY' &
import os, socket, sys, signal
path = sys.argv[1]
srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
srv.bind(path)
srv.listen(1)
# Signal readiness by touching a sentinel — harness waits for it.
open(path + ".ready", "w").close()
try:
    srv.settimeout(60)
    c, _ = srv.accept()
    with c:
        while True:
            data = c.recv(4096)
            if not data: break
            c.sendall(data.upper())
except socket.timeout:
    sys.exit(0)
finally:
    srv.close()
PY
    local echo_pid=$!
    echo "$echo_pid" > "$echo_pid_file"
    # Wait for the echo server to bind.
    local elapsed=0
    while (( elapsed < 5 )) && [[ ! -f "${sock}.ready" ]]; do
        sleep 1; (( ++elapsed ))
    done
    if [[ ! -f "${sock}.ready" ]]; then
        fail 'host echo server never signalled ready'
        kill -9 "$echo_pid" 2>/dev/null || true
        rm -f "$sock" "${sock}.ready"
        return
    fi

    repack_with "
        cp $FIXTURES/assets/vsock-out-demo.sh $ROOTFS/vsock-out-demo.sh
        chmod +x $ROOTFS/vsock-out-demo.sh
        write_config /bin/sh /vsock-out-demo.sh
    "

    MACHINEN_VSOCK="out:5678:$sock" MACHINEN_BOOT_TEST=1 "$TEST_BIN" </dev/null 2>"$log" &
    local vm_pid=$!
    local elapsed=0
    local done=0
    while (( elapsed < 40 )); do
        if grep -qE 'vsock-out-demo: (OUTBOUND OK|OUTBOUND MISMATCH)' "$log" 2>/dev/null; then done=1; break; fi
        sleep 1; (( ++elapsed ))
    done
    kill -9 $vm_pid 2>/dev/null || true
    wait $vm_pid 2>/dev/null || true
    kill -9 "$echo_pid" 2>/dev/null || true
    rm -f "$sock" "${sock}.ready" "$echo_pid_file"

    if (( done == 0 )); then
        fail 'guest never emitted OUTBOUND verdict'
        return
    fi
    grep -q 'vsock-out-demo: OUTBOUND OK' "$log" \
        && pass 'guest-initiated round-trip (cid=2) returned uppercased bytes' \
        || fail 'guest-initiated round-trip mismatch (see log)'
    grep -qE 'vsock: out 5678 <->' "$log" \
        && pass 'vsock bridge reported the outbound mapping' \
        || fail 'vsock bridge did not log outbound mapping'
}

smoke_snapshot_harness() {
    echo "--- snapshot-harness ---"
    local log=/tmp/microvm-smoke-snapshot-harness.log
    local goldens=$FIXTURES/snapshot/harness/goldens.txt

    # Build the harness on demand (same pattern as net-bench-probe).
    local src=$FIXTURES/../assets/snapshot-harness.zig
    local bin=$ROOTFS/snapshot-harness
    if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
        zig build-exe "$src" \
            -target aarch64-linux-musl -static -O ReleaseSmall \
            -lc -femit-bin="$bin" >/dev/null 2>&1 || { fail "harness build failed"; return; }
        rm -f "$bin.o"
    fi

    repack_with "write_config /snapshot-harness"
    # 10M SHA256 iters in-guest is a few seconds of compute on top of
    # boot/teardown; 60s timeout has plenty of slack.
    run_vmm 'printf ""' 60 "$log"

    # Extract the three checkpoint hashes we treat as goldens. Other
    # 100k-interval lines exist; we only pin these three.
    extract_hash() {
        sed -nE "s/^snapshot-harness: iter=$1 hash=([0-9a-f]{64})\$/\\1/p" "${log}.clean" | tail -1
    }
    local got_10k got_1m got_10m
    got_10k=$(extract_hash 10000)
    got_1m=$(extract_hash 1000000)
    got_10m=$(extract_hash 10000000)

    if [[ -z "$got_10k" || -z "$got_1m" || -z "$got_10m" ]]; then
        fail "snapshot-harness: missing checkpoint lines (10k='$got_10k' 1m='$got_1m' 10m='$got_10m'); see ${log}.clean"
        return
    fi
    pass 'snapshot-harness: produced all three checkpoint lines'

    # First run on a host with no goldens: write what we got so the
    # operator can inspect + commit. Subsequent runs verify against
    # the committed file. Diverging across HVF/KVM means we have a
    # determinism problem in pure-CPU compute, which must be fixed
    # before any snapshot work begins.
    if [[ ! -f "$goldens" ]]; then
        mkdir -p "$(dirname "$goldens")"
        cat > "$goldens" <<EOF
# Deterministic snapshot-harness reference hashes.
# Generated on $(uname -s) $(uname -m).
# Both HVF and KVM must produce these; divergence is a foundational
# bug, not a snapshot bug.
10000=$got_10k
1000000=$got_1m
10000000=$got_10m
EOF
        echo "  wrote $goldens (review and commit)"
        return
    fi

    local exp_10k exp_1m exp_10m
    exp_10k=$(awk -F= '/^10000=/{print $2}' "$goldens")
    exp_1m=$(awk -F=  '/^1000000=/{print $2}' "$goldens")
    exp_10m=$(awk -F= '/^10000000=/{print $2}' "$goldens")

    [[ "$got_10k" == "$exp_10k" ]] && pass "iter=10000 hash matches golden"    || fail "iter=10000 mismatch (got=$got_10k exp=$exp_10k)"
    [[ "$got_1m"  == "$exp_1m"  ]] && pass "iter=1000000 hash matches golden"  || fail "iter=1000000 mismatch (got=$got_1m exp=$exp_1m)"
    [[ "$got_10m" == "$exp_10m" ]] && pass "iter=10000000 hash matches golden" || fail "iter=10000000 mismatch (got=$got_10m exp=$exp_10m)"
}

case "$MODE" in
    repl)       smoke_repl ;;
    criu)       smoke_criu ;;
    net)        smoke_net ;;
    net-bench)  smoke_net_bench ;;
    blk)        smoke_blk ;;
    cc)         smoke_cc ;;
    cc-session) smoke_cc_session ;;
    spawn)      smoke_spawn ;;
    vsock)             smoke_vsock ;;
    vsock-out)         smoke_vsock_out ;;
    winsize)           smoke_winsize ;;
    files)             smoke_files ;;
    cc-session-vsock)  smoke_cc_session_vsock ;;
    node-http)         smoke_node_http ;;
    snapshot-harness)  smoke_snapshot_harness ;;
    all)               smoke_repl; smoke_criu; smoke_net; smoke_net_bench; smoke_blk; smoke_cc; smoke_spawn; smoke_vsock; smoke_vsock_out; smoke_winsize; smoke_files; smoke_node_http; smoke_cc_session; smoke_cc_session_vsock; smoke_snapshot_harness ;;
    *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac

echo
echo "summary: $PASS passed, $FAIL failed"
exit $(( FAIL == 0 ? 0 : 1 ))
