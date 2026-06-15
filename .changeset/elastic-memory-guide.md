---
"@machinen/runtime": minor
---

Add goal-driven VM memory resources via `boot({ resources: { memory: { maxMib, reclaim: "auto" } } })`, keep `memory` as a compatibility alias, and expose `memoryStats().balloonReclaimedBytes` as the clearer free-page-reporting reclaim counter.

Document the user-facing memory model with a simple guide covering ceiling versus host footprint, lazy grow-on-touch allocation, balloon reclaim, and the macOS `phys_footprint` caveat.
