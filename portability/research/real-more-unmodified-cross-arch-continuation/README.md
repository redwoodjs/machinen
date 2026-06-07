# Real `/usr/bin/more` unmodified cross-arch continuation

This lane tests whether the descriptor continuation approach that worked for
unmodified `/usr/bin/less` also applies to a nearby real binary:
`/usr/bin/more`.

The harness launches system `more` on a regular file under a controlled pty,
waits until the first page is rendered and the process is blocked in
`read(fd)` on that pty, then probes a small key matrix in same-architecture and
bidirectional cross-architecture descriptor-continuation modes. Unlike `less`,
util-linux `more` blocks in `poll`/`ppoll` over the pty/signalfd set rather than
in a direct `read(fd)`, so the detector models that narrower input-wait shape.

Tested keys:

- `SPACE`
- `b` from the first page, modeled as a valid top-of-file no-op/no-redraw state
  only when the process remains at the first page
- `q`

This is target-native descriptor materialization only. It does not claim
arbitrary process restore, source-ISA emulation, raw VM replay, or raw
stack/heap/register reconstruction.

Run:

```sh
portability/research/real-more-unmodified-cross-arch-continuation/verify.sh
```

The retained result is in `retained/report.json`.
