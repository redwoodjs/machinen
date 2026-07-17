---
"@machinen/runtime": patch
---

Publish only changed and deleted writable live-mount paths at sync points. Untouched mounts now skip file copying, so exiting an interactive VM no longer archives and rewrites the full workspace.
