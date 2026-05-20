# Native memory translation

Issue #448 classifies and relocates pointer-bearing process memory for native
cross-ISA restore.

## Command

```sh
pnpm native-memory-translate
```

The proof preserves an integer word, relocates a metadata-proven pointer, and
refuses an ambiguous pointer-like word.

## Contract

Each word considered for relocation carries a classification and proof source:

- `integer` words are preserved as bytes;
- `pointer`, `code-pointer`, and `thread-pointer` words require a target value;
- `ambiguous` words or `proof: none` refuse.

This avoids treating every pointer-shaped integer as a pointer. A word is
relocated only when DWARF, sidecar metadata, symbols, or an explicit policy has
proven its meaning.

## Refusals

- `pointer-ambiguous` when a word cannot be proven pointer vs integer, or when a
  data pointer has no target value;
- `code-location-unknown` when a code pointer lacks a mapped target address.

The result is a relocation report that later restore stages can apply to
`native-memory.bin` after target mappings are materialized.
