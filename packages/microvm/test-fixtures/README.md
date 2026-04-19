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

## Regenerate `virt.dtb` (ARM virt machine device tree)

Requires `qemu-system-aarch64` (`brew install qemu`).

```bash
cd packages/microvm/test-fixtures
qemu-system-aarch64 -machine virt,dumpdtb=virt.dtb \
  -cpu cortex-a72 -m 128M -nographic
```

QEMU dumps the DTB and exits. File is ~1 MB (padded with zeros
after the real data — valid per the header's size field).
