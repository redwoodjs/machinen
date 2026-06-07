# Real pipeline and supervisor ladder

This lane adds process ownership, pipe boundaries, signal forwarding, and an
explicit socket refusal to the descriptor-continuation research ladder.

Accepted cases:

- finite pipeline: `yes line | head -n 50` completes and cleans up
- interactive pipeline pager: `seq 1 200 | less`, then `SPACE`
- interactive pipeline pager: `seq 1 200 | less`, then `q`
- producer plus pager: generated-repo `git log | less`, producer drained, then
  `q`
- signal-forwarding supervisor with one `sleep` child
- signal-forwarding supervisor with two `sleep` children

Refused case:

- Python socket listener with a live socket fd. This is deliberately retained as
  a refusal, not support.

All accepted rows require same-architecture behavior plus bidirectional amd64 ↔
arm64 descriptor-continuation evidence. The socket row must refuse in same-arch,
source, and target roles. This lane does not claim arbitrary process restore,
source-ISA emulation, raw VM replay, or raw stack/heap/register reconstruction.

Run:

```sh
portability/research/real-pipeline-and-supervisor-ladder/verify.sh
```

The retained result is `proved-with-refusals` in `retained/report.json`.
