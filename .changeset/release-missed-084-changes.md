---
"@machinen/cli": patch
"@machinen/runtime": patch
---

Ship the changes that missed the 0.8.4 publish: show live byte and percentage progress while `machinen run` downloads missing base assets, and preserve stdin for foreground workloads when writable live mounts use shutdown sync.
