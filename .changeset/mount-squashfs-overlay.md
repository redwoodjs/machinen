---
"@machinen/runtime": minor
"@machinen/microvm": minor
"@machinen/squashfs-tools-arm64-darwin": minor
"@machinen/squashfs-tools-arm64-linux": minor
---

Relocate the `--mount` payload from the initramfs cpio to a snapshotted squashfs+ext4 overlay (#272). The host source dir now materialises into a content-addressed `~/.cache/machinen/mountdisk/<key>.sqfs` (read-only lower) and a per-VM sparse `mount-upper.img` (ext4 RW upper); both are fd-passed to the VMM as `/dev/vdc` and `/dev/vdd`, and `/init` layers them as a single overlayfs at `/<guest>/`. Guest writes survive snapshot/restore via reflinked `mount-lower.sqfs` + `mount-upper.img` in the bundle dir, and the host source dir is never consulted at runtime — same trust model the cpio path had, plus snapshotability and no boot-time RAM cost. Also adds `mountDiskUpperSizeBytes` to `boot()` (default 4 GiB sparse, mirrors `rootDiskSizeBytes`), bundled `mksquashfs` packages for arm64 darwin + linux, and the `BOOT_MOUNTDISK_TOOL_MISSING` error code for hosts without squashfs-tools.
