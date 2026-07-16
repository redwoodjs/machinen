---
"@machinen/runtime": patch
---

Preserve stdin for foreground workloads when writable live mounts enable the shutdown sync wrapper, so interactive tools remain attached to the VM terminal instead of exiting on EOF.
