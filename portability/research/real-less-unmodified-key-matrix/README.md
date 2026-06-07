# Real less unmodified key matrix

This lane intentionally tries a broader set of unmodified `/usr/bin/less` commands and records what fails.

It runs a same-arch behavioral probe first, then bidirectional cross-arch descriptor continuation probes for each key. Failures are retained as evidence and do not make the experiment command fail.

Current retained result: `all-accepted`. `b` and `g` are treated as valid no-op/no-redraw top-of-file states from the first page. The search-repeat case uses an isolated per-run `LESSHISTFILE` and sends `/line-050` before `n`, so it does not rely on host-global less history.

Keys:

- `SPACE`
- `b`
- `/line-050`
- `/line-050` followed by `n`
- `g`
- `G`
- `q`

Run:

```sh
portability/research/real-less-unmodified-key-matrix/verify.sh
```
