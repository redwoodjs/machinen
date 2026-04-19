# test fixtures for the microvm package

Large binaries (kernel images, device tree blobs) live here but
aren't checked in. Regenerate locally with the commands below.

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
