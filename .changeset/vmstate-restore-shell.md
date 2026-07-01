---
"@machinen/runtime": minor
---

Vmstate snapshots now record the exact rootfs, kernel, and optional DTB bytes they were created with. Restore checks the target machine's files before booting the frozen VM state: the files may live at different paths, but their bytes must match.

This makes cross-machine vmstate restore safer, but also stricter. Keep or version baked images that existing snapshots depend on instead of overwriting them in place.
