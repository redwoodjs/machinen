---
"@machinen/runtime": minor
"@machinen/cli": minor
---

Make lazy-pages restore the default for `restore()` and `fork()` (#263). Pages stream on-demand from the host via vsock-FUSE so a fork's host RSS stays proportional to what it actually touches, not the parent's high-water mark.

Breaking surface change:

- Runtime: `RestoreOptions.lazyPages` and `ForkOptions.lazyPages` are gone. The new opt-out is `eager: true`, which reinstates the pre-#266 tar-on-/dev/vdb path.
- CLI: `machinen restore --lazy-pages` is gone. The default is now lazy; pass `--eager` to opt back into eager restore.
