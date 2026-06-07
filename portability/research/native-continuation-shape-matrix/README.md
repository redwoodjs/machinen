# Native continuation shape matrix

This lane makes support comparable across proof binaries by indexing the
**CPU/memory/resource shape**, not the binary name. The binary is evidence for a
shape row; it is not the support axis.

The matrix verifies that every row has:

- same-architecture accepted/refused evidence
- amd64 → arm64 source+target evidence
- arm64 → amd64 source+target evidence
- a claim guard that does not claim arbitrary process restore, raw VM replay,
  source-ISA emulation, metadata-only success, or raw heap/stack/register restore
- no skipped row for a supported claim
- classifier coverage where accepted classifier results include an
  architecture-neutral descriptor and refused classifier results include no descriptor

Promoted supported shape proofs:

- `less`: controlled pty pager input wait with empty queue
- `vi`: live unsaved editor buffer, target-native save continuation
- `nano`: live unsaved editor buffer, target-native writeout continuation
- `python3 -i`: live primary REPL prompt, target-native expression continuation
- `sqlite3`: live prompt after durable writes, target-native query continuation
- `make`: live controlled recipe gate, target-native remaining work
- `top`: live rendered TUI frame, target-native quit continuation
- `watch`: live rendered TUI frame, target-native quit continuation
- `find`: live controlled walk gate, target-native stable traversal

Promoted refusal shape proofs:

- live TCP transfer with partial body (`curl` proof)
- live partial archive stream (`tar` proof)
- live partial copy state (`rsync` proof)
- live cipher stream state (`openssl enc` proof)

The matrix is wired to the generic classifier in
[`../native-continuation-classifier/`](../native-continuation-classifier/). The
classifier is intentionally shape-oriented. It inspects `/proc/$pid/fd`,
`/proc/$pid/syscall`, `/proc/$pid/wchan`, pty queue bytes where available, and
classifies:

- accepted: controlled pty read wait with empty queue
- refused: process with socket fd
- refused: unclassified process shape

Run:

```sh
portability/research/native-continuation-shape-matrix/verify.sh
```

Retained outputs:

- `retained/report.json` — shared matrix verification
- `retained/probe-report.json` — amd64 and arm64 detector probe results
