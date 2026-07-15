---
"@machinen/runtime": patch
---

Fix writable live mounts dropping nested files during shutdown sync by assigning recreated paths fresh FUSE node IDs and avoiding a duplicate flush through stale overlay dentries.
