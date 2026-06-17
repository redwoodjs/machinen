---
"@machinen/runtime": patch
---

Preserve sparse rootdisk holes during prebake extraction and Linux copy fallback so boot and restore avoid full 2 GiB physical writes when reflinks are unavailable.
