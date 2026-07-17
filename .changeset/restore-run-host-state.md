---
"@machinen/cli": patch
---

Restore normal host configuration for signed coding-agent recipes. State below guest `/root` now mirrors the matching host-home path, external symlink roots are mounted automatically, and approvals are tied to both the signed recipe digest and the resolved host access.
