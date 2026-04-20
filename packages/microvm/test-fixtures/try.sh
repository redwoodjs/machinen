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
        # Drop straight into an interactive bash inside the guest. With
        # virtio-net + virtio-blk both available, if you bring eth0 up
        # (`/bin/if-up eth0 && /bin/gw-set 10.0.2.2`) you can curl, npm
        # install, whatever.
        cat > "$ROOTFS/demo.sh" <<'SH'
#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH HOME=/root TERM=linux PS1='microvm:\w# '
echo ""
echo "=== machinen-microvm — interactive shell ==="
echo "hints:"
echo "  /bin/if-up eth0                                # bring eth0 up"
echo "  /bin/gw-set 10.0.2.2                           # default route via slirp"
echo "  echo 'nameserver 10.0.2.3' > /etc/resolv.conf  # use slirp DNS"
echo "  claude --version                               # (CC is already installed)"
echo "  exit or Ctrl-D                                 # to quit (kernel will panic — expected)"
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
