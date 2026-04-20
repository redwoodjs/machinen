# test fixtures for the microvm package

Large binaries (kernel images, device tree blobs) live here but
aren't checked in. Regenerate locally with the commands below.

## Tests

Two layers — fast unit tests in the Zig source, plus integration
smoke tests here that boot the whole VMM.

**Unit tests** (`zig build test` from `packages/microvm/`):
HVF lifecycle, MMIO trap handling, kernel-image header parse, PSCI
shutdown, and the PL011 RX state machine (pushRx / IMSC-gated
irqAsserted / ICR clears / DR drains / FR.RXFE / PrimeCell IDs).
17 tests, all run in-process, finish in seconds.

One cosmetic quirk: `zig build test` prints a `failed command: ...
--listen=-` line at the end even when every test passes. The overall
build exits 0; the noise is zig 0.16's test runner panicking with
`EndOfStream` when the parent closes its IPC stdin. Not ours.

**Integration smoke tests** (`test-fixtures/smoke.sh [repl|criu|all]`):
spins up the full VMM with an initramfs, asserts specific behavior.
Needs the kernel Image + virt.dtb + rootfs/ set up (see below). Takes
~20 s per mode on an M-series Mac.

- `repl` — boots with `exec node` as init, pipes `1 + 1` then
  `.exit` at the REPL, checks for the banner, the value `2`, and
  a clean panic-on-init-exit.
- `criu` — boots the fork demo, checks that `dump OK` and
  `restore OK` both happened, and that the `count file:` value
  after restore is strictly greater than before the dump.

## Quick: try your own microVM (with your own files inside)

You want to put some files in a Linux guest, boot it, see them
there. Here's the fastest path.

### Once (setup)

```bash
# 1. From macOS, install tooling:
brew install zig dtc          # and Docker/OrbStack if you want the easy rootfs path

# 2. Get the kernel (one time — it's 27 MB, not in git):
cd packages/microvm/test-fixtures
docker run --rm --platform linux/arm64 -v "$(pwd)":/out \
  debian:bookworm-slim bash -c '
    apt-get update -qq > /dev/null &&
    apt-get install -y --no-install-recommends linux-image-cloud-arm64 > /dev/null &&
    cp /boot/vmlinuz-* /out/Image
  '

# 3. Compile the device tree:
dtc -I dts -O dtb virt.dts -o virt.dtb
```

### Every time you change what's inside the guest

The guest's filesystem is whatever you put in a directory
called `rootfs/` here. There's a Python script that packs that
directory into the cpio archive format the kernel expects.

**Minimum working rootfs**: a directory with a program at `/init`
(plus whatever else you want). The kernel runs `/init` as PID 1
when it boots.

```bash
cd packages/microvm/test-fixtures

# Option A: start from a real Debian userspace (has bash, coreutils,
# node, everything; ~300 MB):
docker run --rm --platform linux/arm64 node:lts-slim \
  sh -c 'true' > /dev/null  # make sure the image is pulled
CID=$(docker create --platform linux/arm64 node:lts-slim)
docker export "$CID" -o rootfs.tar
docker rm "$CID"
rm -rf rootfs && mkdir rootfs
tar -xf rootfs.tar -C rootfs
rm rootfs.tar

# Option B: start from our tiny hand-written init (1 KB, single
# binary from init.c) — already produced:
#   rootfs/init        ← the binary
#   rootfs/dev/console ← added automatically by mkinitramfs.py

# Either way, put your own files in. For example:
echo 'print("hello from python inside the microVM")' > rootfs/demo.py
mkdir -p rootfs/srv
echo "my custom data" > rootfs/srv/data.txt

# Tell /init what to do. The shell-script path expects /demo.sh
# as the entry point; edit it to do whatever you want:
cat > rootfs/demo.sh <<'SH'
#!/bin/sh
echo "hello from my custom demo"
ls -la /srv
cat /srv/data.txt
# keep init alive — the kernel panics if init ever exits
sleep 999999
SH
chmod +x rootfs/demo.sh

# Pack it into the cpio archive the kernel boots from:
python3 mkinitramfs.py --rootfs rootfs
```

### Run it

```bash
cd packages/microvm
MACHINEN_BOOT_TEST=1 zig build test
```

You'll see kernel boot messages stream past on your terminal,
then your `/demo.sh` output. Kill with Ctrl-C.

### What your init can do

- **Mount filesystems**: `mount -t proc proc /proc`,
  `mount -t sysfs sysfs /sys`, `mount -t devtmpfs devtmpfs /dev`
  (the hand-written init.c does this already; a Debian rootfs
  usually has these in fstab).
- **Run programs**: `exec node myscript.js`, `/bin/bash`, etc.
- **Write files**: anywhere on the in-RAM filesystem. Changes
  are lost when the VM stops (no persistent disk yet).
- **Print things**: `echo` and friends. Output comes out on
  your host terminal via the emulated serial port.

### What your init can't do (yet, in this VMM)

- No network (the VMM doesn't emulate virtio-net yet).
- No persistent disk — the initramfs _is_ the filesystem.

### Fork a Node process with CRIU (the hot-move primitive)

There's a ready-made demo that freezes a running Node counter, kills
the original process, and resumes it in a brand-new process whose
counter picks up where the original left off. Proof that the machinen
primitive works end to end inside our VMM.

Build the two helper tools (first time only):

```bash
cd packages/microvm/test-fixtures
zig cc -target aarch64-linux-musl -static -Os -o rootfs/bin/lo-up  lo-up.c
zig cc -target aarch64-linux-musl -static -Os -o rootfs/bin/no-iou no-iou.c
```

- `lo-up` brings the loopback interface up (CRIU's kerndat probes
  connect() to loopback; without this they fail).
- `no-iou` runs a child with a seccomp filter that blocks
  `io_uring_setup`. Node's libuv opens io_uring rings on recent
  kernels and CRIU can't dump a process with live io_uring state.
  The wrapper forces libuv's epoll fallback.

Copy the demo scripts into the rootfs and repack:

```bash
cp counter.js fork-demo.sh demo.sh rootfs/
python3 mkinitramfs.py --rootfs rootfs
```

Boot it:

```bash
cd ..
MACHINEN_BOOT_TEST=1 zig build test
```

Expected progression on the guest console:

```
=== starting counter ===
count file: 3                 ← Node has been ticking for ~4s
=== dumping pid=127 ===
dump OK                       ← CRIU wrote image files
=== count file should be frozen ===
count file: 3                 ← original process is gone
=== restoring ===
restore OK                    ← brand new process, same state
=== count file after restore ===
count file: 7                 ← kept counting from 3, not from 1
```

## What we need

- `Image` — an arm64 Linux kernel, uncompressed, header starts
  with magic `ARMd` at offset 0x38.
- `virt.dtb` — a device tree describing a QEMU-style "virt"
  machine with PL011 at 0x9000000, memory at 0x40000000, and
  PSCI.

## Regenerate `Image` (Debian cloud-arm64 kernel)

Requires Docker / OrbStack running locally. Runs a Debian arm64
container, installs the kernel package, copies the kernel out:

```bash
cd packages/microvm/test-fixtures
docker run --rm --platform linux/arm64 -v "$(pwd)":/out \
  debian:bookworm-slim bash -c '
    apt-get update -qq > /dev/null &&
    apt-get install -y --no-install-recommends linux-image-cloud-arm64 > /dev/null &&
    cp /boot/vmlinuz-* /out/Image
  '
```

Resulting `Image` is ~27 MB, magic `ARMd`, `text_offset=0x0`,
`image_size=0x1aa0000`.

## Regenerate `virt.dtb` (custom device tree)

We ship the source (`virt.dts`) in git. Compile it with `dtc`
(`brew install dtc`):

```bash
cd packages/microvm/test-fixtures
dtc -I dts -O dtb virt.dts -o virt.dtb
```

Two things about our DTS differ from what QEMU produces by default:

1. **Interrupt controller (GIC) redistributor region is 32 MB**,
   relocated to `0x10000000`. Apple's in-kernel GIC wants 32 MB;
   QEMU's default DTB only reserves 15.4 MB at `0x080A_0000` and
   the serial port lives inside that overlapping range.
2. **Kernel command line** in `/chosen/bootargs` includes
   `earlycon=pl011,0x9000000` so the kernel can print before it
   sets up its full console.

To start from scratch (regenerate the DTS from QEMU, then patch):

```bash
qemu-system-aarch64 -machine virt,gic-version=3,dumpdtb=virt-raw.dtb \
  -cpu cortex-a72 -m 128M -kernel Image \
  -append "earlycon=pl011,0x9000000 console=ttyAMA0" -nographic
dtc -I dtb -O dts virt-raw.dtb -o virt.dts
# then edit intc@8000000's `reg` to place redistributor at 0x10000000
# with size 0x2000000, save, compile as above.
```
