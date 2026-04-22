#!/usr/bin/env bash
# End-to-end demo: freeze a Node process inside a microVM on this Mac,
# ship the dump to a Linux host, restore it there, watch the counter
# continue. The two hosts never agree on anything except the CRIU
# images and the counter file's contents.
#
# Usage:
#   ./test-fixtures/assets/handoff.sh <linux-ssh-target>   # e.g. friend@100.126.46.90
#
# What it does:
#   1. On the Mac: build VMM, stage handoff-dump.sh, boot a VM under HVF,
#      let it dump a Node counter and write the dump as a cpio stream to
#      /dev/vda (backed by disk.img).
#   2. Extract that cpio stream into ./cpdump on this host.
#   3. Ship ./cpdump and the kernel/dtb/initramfs to the Linux host.
#   4. On the Linux host: build a workspace cpio carrying the images,
#      concat it onto the base initramfs, and boot the KVM VMM with a
#      restore-only demo.
#   5. Print the guest's CRIU transcript.

set -euo pipefail

die() { echo "$*" >&2; exit 1; }

TARGET=${1:-}
[[ -n "$TARGET" ]] || die "usage: $0 <linux-ssh-target>"

HERE=$(cd "$(dirname "$0")/../.." && pwd)
cd "$HERE"

ROOTFS=test-fixtures/rootfs
FIXTURES=test-fixtures
DISK=test-fixtures/disk.img
STAGE=/tmp/machinen-handoff

# --- Mac: stage + boot + dump --------------------------------------
echo "==> ensuring helpers are built"
for helper in lo-up no-iou; do
    src=$FIXTURES/assets/$helper.c
    bin=$ROOTFS/usr/bin/$helper
    if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
        zig cc -target aarch64-linux-musl -static -Os -o "$bin" "$src"
    fi
done

echo "==> staging handoff-dump.sh as the guest's entry"
cp "$FIXTURES/assets/counter.js"          "$ROOTFS/counter.js"
cp "$FIXTURES/assets/handoff-dump.sh"     "$ROOTFS/handoff-dump.sh"
chmod +x "$ROOTFS/handoff-dump.sh"
rm -f "$ROOTFS/demo.sh"
cat > "$ROOTFS/machinen-config.json" <<'JSON'
{
  "cmd": ["/bin/sh", "/handoff-dump.sh"],
  "env": {
    "PATH": "/usr/local/bin:/usr/bin:/bin:/sbin",
    "NODE_NO_WARNINGS": "1",
    "HOME": "/root"
  }
}
JSON

echo "==> repacking initramfs"
node --import tsx "$FIXTURES/assets/mkinitramfs.ts" --rootfs "$ROOTFS"

echo "==> zeroing disk.img so cpio trailer detection is unambiguous"
[[ -f "$DISK" ]] || die "missing $DISK (run test-fixtures/assets/smoke.sh once to create it)"
dd if=/dev/zero of="$DISK" bs=1M count=128 conv=notrunc status=none

echo "==> building VMM"
zig build test 2>&1 | grep -E "^error:|warning:" | head -20 || true
# Multiple test binaries land in .zig-cache; pick the one that has the
# MACHINEN_BOOT_TEST gate (that's the boot test).
TEST_BIN=""
for f in $(ls -t .zig-cache/o/*/test 2>/dev/null); do
    if strings "$f" 2>/dev/null | grep -q MACHINEN_BOOT_TEST; then
        TEST_BIN="$f"; break
    fi
done
[[ -x "$TEST_BIN" ]] || die "no VMM boot-test binary under .zig-cache/o/*/test"

echo "==> booting Mac VM; disk.img is auto-picked up as /dev/vda"
LOG=/tmp/machinen-handoff-mac.log
MACHINEN_BOOT_TEST=1 "$TEST_BIN" </dev/null 2>"$LOG" &
VM_PID=$!
for i in $(seq 1 60); do
    if grep -q "cpio write done" "$LOG" 2>/dev/null; then break; fi
    sleep 1
done
# Give the PSCI poweroff a moment to propagate.
sleep 3
kill -9 "$VM_PID" 2>/dev/null || true
wait "$VM_PID" 2>/dev/null || true

if ! grep -q "cpio write done" "$LOG"; then
    echo "Mac dump never wrote cpio. Last 40 lines of guest log:" >&2
    tail -40 "$LOG" >&2
    exit 1
fi

echo "==> extracting cpio from disk.img"
rm -rf "$STAGE/cpdump" && mkdir -p "$STAGE/cpdump"
# macOS cpio auto-detects format on -i; omit -H.
(cd "$STAGE/cpdump" && cpio -i --quiet < "$HERE/$DISK" 2>/dev/null) || true
[[ -n "$(ls -A "$STAGE/cpdump" 2>/dev/null)" ]] || die "cpio extract produced no files"
ls "$STAGE/cpdump" | head

echo "==> rebuilding base initramfs with handoff-restore.sh as entry"
cp "$FIXTURES/assets/handoff-restore.sh" "$ROOTFS/handoff-restore.sh"
chmod +x "$ROOTFS/handoff-restore.sh"
rm -f "$ROOTFS/demo.sh"
cat > "$ROOTFS/machinen-config.json" <<'JSON'
{
  "cmd": ["/bin/sh", "/handoff-restore.sh"],
  "env": {
    "PATH": "/usr/local/bin:/usr/bin:/bin:/sbin",
    "NODE_NO_WARNINGS": "1",
    "HOME": "/root"
  }
}
JSON
node --import tsx "$FIXTURES/assets/mkinitramfs.ts" --rootfs "$ROOTFS"

echo "==> packing CRIU images as a workspace cpio"
node --import tsx "$FIXTURES/assets/mkinitramfs.ts" --workspace "$STAGE/cpdump" \
    --out "$STAGE/cpdump.cpio" --max-mb 200

echo "==> concatenating base + workspace + terminator"
cat "$FIXTURES/initramfs.cpio" "$STAGE/cpdump.cpio" > "$STAGE/combined.cpio"
# Newc cpio trailer: TRAILER!!! as the name, zero-length body.
node --import tsx - "$STAGE/combined.cpio" <<'JS'
import { appendFileSync } from "node:fs";
const path = process.argv[2];
const name = Buffer.concat([Buffer.from("TRAILER!!!", "ascii"), Buffer.from([0])]);
const fields = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, name.length, 0];
let hdr = "070701";
for (const v of fields) hdr += v.toString(16).padStart(8, "0");
let out = Buffer.concat([Buffer.from(hdr, "ascii"), name]);
while (out.length % 4) out = Buffer.concat([out, Buffer.from([0])]);
appendFileSync(path, out);
JS

echo "==> shipping combined initramfs to $TARGET ($(du -h "$STAGE/combined.cpio" | cut -f1))"
ssh "$TARGET" 'mkdir -p ~/src/machinen/packages/microvm/test-fixtures'
rsync -az "$STAGE/combined.cpio" \
    "$TARGET:~/src/machinen/packages/microvm/test-fixtures/initramfs.cpio"
# Only need to ship kernel + dtb if the remote doesn't have them yet;
# rsync skips if unchanged.
rsync -az "$FIXTURES/Image" "$FIXTURES/virt.dtb" \
    "$TARGET:~/src/machinen/packages/microvm/test-fixtures/"

echo "==> on $TARGET: boot VMM with combined initramfs, watch restore"
ssh "$TARGET" bash -s <<'REMOTE'
set -e
cd ~/src/machinen/packages/microvm
# Temporarily bump capture_bytes so the full CRIU transcript lands
# before the break triggers.
sed -i.bak 's/.capture_bytes = 512,/.capture_bytes = 65536,/' src/boot_kvm.zig
~/zig-0.16.0/zig test src/root.zig -lc --cache-dir .zig-cache \
    --test-no-exec -femit-bin=/tmp/boottest >/dev/null 2>&1
mv src/boot_kvm.zig.bak src/boot_kvm.zig

MACHINEN_BOOT_TEST=1 timeout 90 /tmp/boottest > /tmp/machinen-handoff-linux.log 2>&1 || true
echo "--- CRIU transcript ---"
grep -E "=== |count|restore OK|restore FAILED|/tmp/count" \
    /tmp/machinen-handoff-linux.log || \
    { echo "no markers; full log at /tmp/machinen-handoff-linux.log"; exit 1; }
REMOTE
