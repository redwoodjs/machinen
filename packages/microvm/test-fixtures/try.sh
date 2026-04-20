#!/usr/bin/env bash
# Boot the microVM in one of a handful of ready-made modes.
#
# Usage:
#   ./test-fixtures/try.sh shell   # interactive bash prompt inside the guest
#   ./test-fixtures/try.sh repl    # interactive Node.js REPL (type JS live)
#   ./test-fixtures/try.sh criu    # CRIU freeze/restore demo (counter 5 → 9)
#   ./test-fixtures/try.sh --help
#
# What this actually does:
#   1. Builds the VMM test binary (zig build test).
#   2. Writes the right /demo.sh into rootfs/, plus any helper scripts
#      the mode needs.
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
    repl|criu|criu\ demo|criu-demo|shell|sh|bash) ;;
    *) die "unknown mode: $MODE (try: repl | criu | shell)" ;;
esac

# Resolve the microvm package root.
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"

ROOTFS=test-fixtures/rootfs
FIXTURES=test-fixtures

# --- sanity --------------------------------------------------------
for f in $FIXTURES/Image $FIXTURES/virt.dtb; do
    [[ -f "$f" ]] || die "missing fixture: $f (see test-fixtures/README.md)"
done
[[ -d "$ROOTFS" ]] || die "missing $ROOTFS — see test-fixtures/README.md for how to build it"

# --- stage the mode ------------------------------------------------
case "$MODE" in
    repl)
        cat > "$ROOTFS/demo.sh" <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH
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
        cat > "$ROOTFS/demo.sh" <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH HOME=/root TERM=linux

load_ko() {
    ko=$(find /lib/modules -name "$1.ko" 2>/dev/null | head -1)
    [ -n "$ko" ] && insmod "$ko" 2>/dev/null
}
# Virtio drivers — without these, /dev/vda and eth0 don't exist.
for m in virtio virtio_ring virtio_mmio virtio_blk failover net_failover virtio_net; do
    load_ko "$m"
done

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
echo "  exit or Ctrl-D                # quit (kernel will panic — expected)"
echo ""
exec /bin/bash --login
SH
        ;;
esac

chmod +x "$ROOTFS/demo.sh"

# --- repack + build ------------------------------------------------
echo "==> repacking initramfs"
python3 "$FIXTURES/mkinitramfs.py" --rootfs "$ROOTFS" | tail -1

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
        echo
        # Host terminal in raw mode so each keystroke reaches the guest
        # directly (otherwise your shell line-buffers + double-echoes).
        if [[ -t 0 ]]; then
            HOST_STTY=$(stty -g </dev/tty)
            trap 'stty "$HOST_STTY" </dev/tty 2>/dev/null || true; echo' EXIT INT TERM
            stty raw -echo isig </dev/tty
        fi
        MACHINEN_BOOT_TEST=1 "$TEST_BIN"
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
esac
