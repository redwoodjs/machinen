#!/usr/bin/env bash
# Boot the microVM in one of a handful of ready-made modes.
#
# Usage:
#   ./test-fixtures/try.sh shell            # interactive bash prompt inside the guest
#   ./test-fixtures/try.sh repl             # interactive Node.js REPL (type JS live)
#   ./test-fixtures/try.sh criu             # CRIU freeze/restore demo
#   ./test-fixtures/try.sh vsock            # virtio-vsock echo server + host round-trip
#   ./test-fixtures/try.sh workspace DIR    # shell with DIR mounted at /workspace
#   ./test-fixtures/try.sh --help
#
# What this actually does:
#   1. Builds the VMM test binary (zig build test).
#   2. Writes a mode-specific entry script into rootfs/ plus a
#      machinen-config.json pointing /init at it.
#   3. Repacks initramfs.cpio.
#   4. Runs the VMM. For interactive modes, puts your terminal in raw
#      mode so every keystroke goes straight through to the guest.
#
# Run from anywhere in the repo — the script resolves paths itself.

set -euo pipefail

die() { echo "$*" >&2; exit 1; }

MODE=${1:-}
case "$MODE" in
    --help|-h|"")
        awk '/^$/{exit} NR>1{sub(/^# ?/, ""); print}' "$0"
        exit 0
        ;;
    repl|criu|criu\ demo|criu-demo|shell|sh|bash|vsock|workspace) ;;
    *) die "unknown mode: $MODE (try: repl | criu | shell | vsock | workspace)" ;;
esac

# `workspace <DIR> [--exclude NAME ...]` — shell boot with the host DIR
# cpio'd onto /workspace. Remaining args after DIR pass through as
# additional excludes (default excludes already cover node_modules,
# .git, etc).
WORKSPACE_DIR=""
WORKSPACE_EXTRA=()
if [[ "$MODE" == "workspace" ]]; then
    WORKSPACE_DIR=${2:-}
    [[ -n "$WORKSPACE_DIR" ]] || die "workspace: need a directory. usage: try.sh workspace <DIR> [--exclude NAME]..."
    WORKSPACE_DIR=$(cd "$WORKSPACE_DIR" && pwd)
    [[ -d "$WORKSPACE_DIR" ]] || die "workspace: $WORKSPACE_DIR is not a directory"
    shift 2 || true
    WORKSPACE_EXTRA=("$@")
    # Reuse the shell mode's demo.sh + raw-mode handling.
    MODE=shell
fi

# Resolve the microvm package root.
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"

ROOTFS=test-fixtures/rootfs
FIXTURES=test-fixtures

# --- sanity --------------------------------------------------------
# Fixtures aren't checked in. Fall back to release-assets/ at the repo
# root (populated by scripts/build-base-assets.sh); otherwise tell the
# user to build them.
ASSETS=$(cd "$HERE/../.." && pwd)/release-assets
need_build() {
    die "missing $1
    run ./scripts/build-base-assets.sh to produce release-assets/
    or see test-fixtures/README.md"
}

if [[ ! -f $FIXTURES/Image ]]; then
    [[ -f "$ASSETS/Image-arm64" ]] || need_build "$FIXTURES/Image"
    cp "$ASSETS/Image-arm64" "$FIXTURES/Image"
fi
if [[ ! -f $FIXTURES/virt.dtb ]]; then
    [[ -f "$ASSETS/virt-arm64.dtb" ]] || need_build "$FIXTURES/virt.dtb"
    cp "$ASSETS/virt-arm64.dtb" "$FIXTURES/virt.dtb"
fi
if [[ ! -d $ROOTFS ]]; then
    [[ -f "$ASSETS/rootfs-debian-arm64.tar.gz" ]] || need_build "$ROOTFS"
    mkdir -p "$ROOTFS"
    tar -xzf "$ASSETS/rootfs-debian-arm64.tar.gz" -C "$ROOTFS"
fi

# Write $ROOTFS/machinen-config.json with the positional args as argv.
# TERM=linux is auto-added by /init if absent; the shell-mode entry
# overrides it to xterm-256color, so we don't set TERM here.
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
# Ensure a stale config from a previous try.sh mode doesn't leak into
# this one.
rm -f "$ROOTFS/machinen-config.json"

# --- stage the mode ------------------------------------------------
case "$MODE" in
    vsock)
        # Guest-side echo server + kernel modules. Host side talks to
        # it through a UDS the VMM listens on; the path is set below
        # via MACHINEN_VSOCK.
        cp "$FIXTURES/vsock-demo.sh" "$ROOTFS/demo.sh"
        ;;
    repl)
        # Capture the host terminal size so Node REPL's line editor
        # wraps to the right column instead of reaching 80 and
        # redrawing over itself.
        if [[ -t 0 ]]; then
            read -r HOST_ROWS HOST_COLS < <(stty size </dev/tty 2>/dev/null || echo "24 80")
        else
            HOST_ROWS=24; HOST_COLS=80
        fi
        cat > "$ROOTFS/demo.sh" <<SH
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
# TERM=dumb disables Node's readline terminal mode (no autocomplete
# preview, no cursor motion) — which otherwise mangles into the
# PL011 byte stream as "Object [console] { log: ... error:le"
# garbage. Plain line-oriented REPL is what we want here.
export PATH TERM=dumb COLUMNS=$HOST_COLS LINES=$HOST_ROWS
stty rows $HOST_ROWS cols $HOST_COLS 2>/dev/null || true
echo ""
echo "=== machinen-microvm — Node.js REPL ==="
echo "(type JS; '.exit' or Ctrl-D to quit; ~10s boot before the '>')"
echo ""
exec /usr/local/bin/node
SH
        ;;
    criu|criu-demo|'criu demo')
        # The CRIU demo needs the lo-up + no-iou helpers and the two
        # scripts. Build the helpers if they're missing.
        for helper in lo-up no-iou; do
            src=$FIXTURES/$helper.c
            bin=$ROOTFS/usr/bin/$helper   # rootfs/bin is a symlink to usr/bin
            if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
                echo "==> building $helper from $src"
                zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
            fi
        done
        cp "$FIXTURES/counter.js"    "$ROOTFS/counter.js"
        cp "$FIXTURES/fork-demo.sh"  "$ROOTFS/fork-demo.sh"
        cp "$FIXTURES/demo.sh"       "$ROOTFS/demo.sh"
        chmod +x "$ROOTFS/fork-demo.sh" "$ROOTFS/demo.sh"
        ;;
    shell|sh|bash)
        # Drop straight into an interactive bash inside the guest with
        # virtio-net + virtio-blk drivers already loaded and a `netup`
        # helper that brings eth0 up in one command.
        #
        # Bake the host's current epoch into the rootfs so the guest
        # can set its clock at boot. Without this the guest's clock
        # starts at 1970 and every TLS cert looks "not yet valid."
        date +%s > "$ROOTFS/etc/machinen-boot-epoch"
        # Capture host terminal size so the first shell isn't stuck at
        # 80x24 before the winsize agent (if any) runs. Written to a
        # small env file the demo.sh sources on boot.
        if [[ -t 0 ]]; then
            read -r HOST_ROWS HOST_COLS < <(stty size </dev/tty 2>/dev/null || echo "24 80")
        else
            HOST_ROWS=24; HOST_COLS=80
        fi
        printf 'HOST_COLS=%s\nHOST_ROWS=%s\n' "$HOST_COLS" "$HOST_ROWS" \
            > "$ROOTFS/etc/machinen-tty"
        cat > "$ROOTFS/demo.sh" <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
# xterm-256color is what the host terminal almost always is. The PL011
# passes bytes through verbatim, so color escapes from ls/grep/less
# land in the host terminal intact.
export PATH HOME=/root TERM=xterm-256color
if [ -f /etc/machinen-tty ]; then
    . /etc/machinen-tty
    export COLUMNS="$HOST_COLS" LINES="$HOST_ROWS"
    stty rows "$HOST_ROWS" cols "$HOST_COLS" 2>/dev/null || true
fi

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
# Virtio drivers — without these, /dev/vda, eth0, and AF_VSOCK don't exist.
for m in virtio virtio_ring virtio_mmio virtio_blk failover net_failover virtio_net \
         vsock vmw_vsock_virtio_transport_common vmw_vsock_virtio_transport; do
    load_ko "$m"
done

# If /file-agent.py was cpio'd in (try.sh workspace mode), start it
# in the background so the host can machinen-push / machinen-pull
# during the session. It binds AF_VSOCK port 1976; the host-side UDS
# is whatever MACHINEN_VSOCK in:1976:... pointed at when the VMM
# was launched.
if [ -x /file-agent.py ]; then
    (python3 /file-agent.py >/var/log/file-agent.log 2>&1 &) 2>/dev/null
fi

# Set the guest clock from the boot epoch the wrapper baked in. TLS
# cert validation needs a plausible current time or everything looks
# "not yet valid."
if [ -f /etc/machinen-boot-epoch ]; then
    date -s "@$(cat /etc/machinen-boot-epoch)" >/dev/null 2>&1
fi

# Seed /root/.bashrc with a `netup` helper so the user doesn't have
# to remember every command to reach the internet. Also add a tiny
# `http` helper because curl isn't in node:lts-slim.
mkdir -p /root
cat > /root/.bashrc <<'RC'
export PS1='microvm:\w# '

# Bring up eth0 with a static IP on slirp's network (10.0.2.15/24,
# gateway 10.0.2.2, DNS 10.0.2.3), in one command.
netup() {
    /bin/if-up eth0 || return 1
    python3 - <<'PY'
import socket, fcntl, struct
SIOCSIFADDR, SIOCSIFNETMASK = 0x8916, 0x891C
def pack(ip):
    return struct.pack('16sH2s4s8s', b'eth0', socket.AF_INET, b'\x00\x00', socket.inet_aton(ip), b'\x00'*8)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
fcntl.ioctl(s, SIOCSIFADDR,    pack('10.0.2.15'))
fcntl.ioctl(s, SIOCSIFNETMASK, pack('255.255.255.0'))
PY
    /bin/gw-set 10.0.2.2 || return 1
    mkdir -p /etc
    echo 'nameserver 10.0.2.3' > /etc/resolv.conf
    echo 'network up: eth0=10.0.2.15, gw=10.0.2.2, dns=10.0.2.3'
    echo 'try: http https://example.com'
}

# curl isn't in node:lts-slim; this is a tiny HTTP client using Python.
# Usage: http <url>
http() {
    python3 - "$1" <<'PY'
import sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={'User-Agent': 'machinen-microvm/0.1'})
with urllib.request.urlopen(req, timeout=15) as r:
    print(f"HTTP {r.status} {r.reason}")
    for k, v in r.headers.items():
        print(f"{k}: {v}")
PY
}
RC

echo ""
echo "=== machinen-microvm — interactive shell ==="
echo "hints:"
echo "  netup                         # bring eth0 up with static IP + DNS"
echo "  http https://example.com      # tiny Python HTTP client (curl isn't here)"
echo "  claude --version              # (CC is already installed)"
echo "  ls /dev/vda                   # virtio-blk disk (if test-fixtures/disk.img exists)"
if [ -d /workspace ]; then
    echo "  cd /workspace                 # your host dir, cpio'd in on boot"
fi
if [ -x /file-agent.py ]; then
    echo "  host: VsockFiles.push/pull    # live file transfer on vsock :1976"
fi
echo "  exit or Ctrl-D                # quit (kernel will panic — expected)"
echo ""
# Drop into /workspace when it was cpio'd in (try.sh workspace mode).
[ -d /workspace ] && cd /workspace
exec /bin/bash --login
SH
        ;;
esac

chmod +x "$ROOTFS/demo.sh"
write_config /bin/sh /demo.sh

# Workspace mode also ships the live file-agent so the host can
# push/pull over vsock during the session. Dropped into rootfs/ so
# the standard mkinitramfs --rootfs pass picks it up automatically;
# guest's demo.sh starts it when /file-agent.py exists.
if [[ -n "$WORKSPACE_DIR" ]]; then
    cp "$FIXTURES/file-agent.py" "$ROOTFS/file-agent.py"
    chmod +x "$ROOTFS/file-agent.py"
fi

# --- repack + build ------------------------------------------------
echo "==> repacking initramfs"
python3 "$FIXTURES/mkinitramfs.py" --rootfs "$ROOTFS" | tail -1

# If the user asked for `workspace <DIR>`, append a second cpio slice
# with the host directory rooted at /workspace. The Linux kernel's
# initramfs unpacker merges concatenated cpio archives in order.
if [[ -n "$WORKSPACE_DIR" ]]; then
    WS_CPIO=$FIXTURES/workspace.cpio
    echo "==> packing workspace: $WORKSPACE_DIR -> /workspace"
    # Forward any extra args from try.sh (--exclude NAME, --max-mb N).
    # Bash: the idiom below expands to nothing (not an empty string)
    # when the array is empty under `set -u`.
    if [[ ${#WORKSPACE_EXTRA[@]} -gt 0 ]]; then
        python3 "$FIXTURES/mkinitramfs.py" --workspace "$WORKSPACE_DIR" --out "$WS_CPIO" "${WORKSPACE_EXTRA[@]}"
    else
        python3 "$FIXTURES/mkinitramfs.py" --workspace "$WORKSPACE_DIR" --out "$WS_CPIO"
    fi
    cat "$WS_CPIO" >> "$FIXTURES/initramfs.cpio"
    rm -f "$WS_CPIO"
fi

echo "==> building VMM test binary"
zig build test >/dev/null 2>&1 || true   # boot test is skip-by-default; that's fine

# The zig build produces two test binaries (one per module). Grab
# the one that references MACHINEN_BOOT_TEST (the boot test).
TEST_BIN=""
for f in $(ls -t .zig-cache/o/*/test 2>/dev/null); do
    if strings "$f" 2>/dev/null | grep -q MACHINEN_BOOT_TEST; then
        TEST_BIN="$f"; break
    fi
done
[[ -x "$TEST_BIN" ]] || die "no boot-test binary found under .zig-cache/o/*/test"

# --- run -----------------------------------------------------------
case "$MODE" in
    repl|shell|sh|bash)
        if [[ "$MODE" == "repl" ]]; then
            echo "==> booting; wait ~10s for the '>' prompt"
            echo "==> quit with .exit (or Ctrl-]Ctrl-C to kill the wrapper)"
        else
            echo "==> booting; wait ~10s for the 'microvm:/#' prompt"
            echo "==> exit with Ctrl-D or 'exit' (kernel will panic — expected)"
        fi
        if [[ -n "$WORKSPACE_DIR" ]]; then
            FILE_SOCK=/tmp/machinen-workspace-files.sock
            rm -f "$FILE_SOCK"
            echo "==> file-agent UDS: $FILE_SOCK (vsock :1976)"
            echo "    host: VsockFiles.push('$FILE_SOCK', localDir, '/workspace')"
            echo "    host: VsockFiles.pull('$FILE_SOCK', '/workspace', localDir)"
        fi
        echo
        # Host terminal in raw mode so each keystroke reaches the guest
        # directly (otherwise your shell line-buffers + double-echoes).
        #
        # `-isig` — critical. With `isig`, the host terminal driver
        # sees Ctrl-C and sends SIGINT to try.sh, which tears the VMM
        # down. We want Ctrl-C to flow through as byte 0x03 so the
        # guest's ttyAMA0 line discipline generates SIGINT INSIDE the
        # guest (interrupt `python` / `claude` / whatever, not the
        # whole VM). Ctrl-D still exits naturally — it reaches bash as
        # 0x04, bash exits at an empty prompt, init dies, kernel
        # panics, VMM stops.
        if [[ -t 0 ]]; then
            HOST_STTY=$(stty -g </dev/tty)
            # No 'INT' in the trap: we're -isig, so the host doesn't
            # generate SIGINT on Ctrl-C in the first place. EXIT covers
            # the normal Ctrl-D → VMM-exits path; TERM covers external
            # kills.
            trap 'stty "$HOST_STTY" </dev/tty 2>/dev/null || true; echo' EXIT TERM
            stty raw -echo -isig </dev/tty
        fi
        if [[ -n "$WORKSPACE_DIR" ]]; then
            MACHINEN_VSOCK="in:1976:$FILE_SOCK" MACHINEN_BOOT_TEST=1 "$TEST_BIN"
        else
            MACHINEN_BOOT_TEST=1 "$TEST_BIN"
        fi
        ;;
    criu|criu-demo|'criu demo')
        echo "==> booting; CRIU demo runs for ~15s after boot"
        LOG=/tmp/microvm-criu.log
        MACHINEN_BOOT_TEST=1 "$TEST_BIN" </dev/null 2>"$LOG" &
        VM_PID=$!
        sleep 32
        kill -9 $VM_PID 2>/dev/null || true
        wait $VM_PID 2>/dev/null || true
        echo
        echo "==> CRIU transcript:"
        grep -E '=== |count file|dump OK|restore OK|dump FAILED|restore FAILED' "$LOG" \
            || { echo "(no CRIU markers found — full log in $LOG)"; exit 1; }
        echo
        echo "==> full guest console in $LOG"
        ;;
    vsock)
        # Run the VM in the background with a vsock bridge listening on
        # /tmp/machinen-vsock.sock → guest port 1234. Wait for the
        # guest "listening" marker, then do a round-trip via nc -U.
        SOCK=/tmp/machinen-vsock.sock
        LOG=/tmp/microvm-vsock.log
        rm -f "$SOCK"
        echo "==> booting VMM with MACHINEN_VSOCK=1234:$SOCK"
        MACHINEN_VSOCK="1234:$SOCK" MACHINEN_BOOT_TEST=1 "$TEST_BIN" </dev/null 2>"$LOG" &
        VM_PID=$!
        # Give the kernel time to load vsock modules and start the echo
        # server (~15s cold boot on an M-series Mac).
        for i in $(seq 1 30); do
            if grep -q "vsock-demo: listening" "$LOG" 2>/dev/null; then break; fi
            sleep 1
        done
        if ! grep -q "vsock-demo: listening" "$LOG" 2>/dev/null; then
            echo "(timeout: guest never reported vsock-demo: listening)"
            kill -9 $VM_PID 2>/dev/null || true
            wait $VM_PID 2>/dev/null || true
            echo "==> tail of $LOG:"; tail -40 "$LOG"
            exit 1
        fi
        echo "==> round-trip: sending 'hello-vsock' via $SOCK"
        # macOS nc doesn't accept -q, and the echo semantics we want
        # (send → wait for reply → close) are awkward in shell. Python
        # is deterministic and everywhere.
        python3 - "$SOCK" <<'PY'
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
    except socket.timeout:
        break
print(f"sent: {msg!r}")
print(f"got:  {data!r}")
if data == msg:
    print("ROUND-TRIP OK")
else:
    print("ROUND-TRIP FAILED")
    sys.exit(1)
s.close()
PY
        echo
        echo "==> guest-side transcript:"
        grep -E "vsock-demo:|virtio" "$LOG" | tail -20 || true
        kill -9 $VM_PID 2>/dev/null || true
        wait $VM_PID 2>/dev/null || true
        echo
        echo "==> full guest console in $LOG"
        ;;
esac
