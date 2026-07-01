---
"@machinen/runtime": minor
---

`boot()` now resolves the release kernel and DTB for normal boots, so callers using the standard Machinen image no longer have to pass those paths by hand. Explicit `kernel` and `dtb` options still win, and test/custom VMM boots that pass `binary` keep their previous behavior.
