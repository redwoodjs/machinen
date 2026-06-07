# Controlled binary corpus

Issue #415 starts the next portable snapshot step: binaries we control, built for more than one CPU architecture.

The fixture source is `packages/microvm/test-fixtures/proof-assets/controlled-binary-corpus.c`. It is a normal C program. It does not call `machinen_checkpoint` and does not write a portable bundle. Instead, it exposes stable symbols and prints deterministic observation markers so later work can practice external capture and semantic extraction.

## Fixtures

The corpus has seven fixtures:

1. `global` — scalar global state.
2. `heap` — a small heap graph with pointer edges.
3. `stack` — a nested function with a live local value at an observation point.
4. `continuation` — a nested function with a stack-local continuation frame and logical continuation id.
5. `resource` — argv/env plus a regular file and saved offset.
6. `threads` — two pthread workers stopped at known semantic points.
7. `dwarf` — globals and heap nodes with layouts recovered from DWARF metadata.

Each fixture prints one `MACHINEN_CONTROLLED_BINARY` JSON marker. Passing `--pause-at-observation` makes the process raise `SIGSTOP` after a marker, leaving the state live for an external capturer.

## Build and verify

Run:

```sh
pnpm controlled-binary-corpus
```

The verifier compiles the source natively, runs all fixtures, and cross-builds Linux binaries for:

- `aarch64-linux-musl`
- `x86_64-linux-musl`

The cross builds prove that the same source can produce arm64 and amd64 controlled binaries. The native run proves the fixtures produce deterministic state before the later raw-capture work begins.
