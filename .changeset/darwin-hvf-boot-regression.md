---
"@machinen/runtime": patch
---

Restore fast Darwin/HVF boots by preferring cached or tar + `mke2fs` rootfs materialization, packing tiny initramfs bundles in process, and keeping common boot planning on the TypeScript fast path.
