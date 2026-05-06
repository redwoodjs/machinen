---
"@machinen/microvm": patch
---

Add `/sbin/machinen-memdirty` workload helper (mmaps N MiB anon, dirties every page, parks on `pause(2)`) and a headline RSS smoke test that boots a parent, dirties N MiB, snapshots, restores with `--lazy-pages`, and asserts the restored VM's host RSS is at least N/2 MiB lighter than the parent's. Catches regressions where a "lazy" restore secretly faults all pages back into host memory (#266).
