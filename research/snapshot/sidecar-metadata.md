# Sidecar metadata for stripped builds

Issue #419 defines the proof-side `.machinen-meta.json` file used when a release binary no longer carries DWARF or a symbol table.

The sidecar is generated from a matching debug build, then the verifier strips the controlled binary with `strip --strip-all`. Capture and restore use only the stripped target plus `.machinen-meta.json`.

## What the sidecar records

The schema lives in [`machinen-meta.schema.json`](./machinen-meta.schema.json). The proof sidecar records:

- program name and stable identity
- allowed source and target architectures
- per-architecture build identity using SHA-256 of the stripped target
- symbol names, addresses, sizes, and types
- type layouts and field offsets
- pointer fields (`head`, `next`) for relocation discovery
- continuation ids and safe observation points
- resource recipes for argv/env/cwd
- refusal rules for resources the proof does not replay

The model is architecture-indexed, so the same JSON shape can describe arm64 and amd64 builds. A real release pipeline can ship both build entries in one file or ship one sidecar per artifact using the same schema.

## Flow

1. Build the controlled corpus with debug info.
2. Read DWARF through the #418 verifier and translate it into `.machinen-meta.json`.
3. Copy and strip the target binary.
4. Validate that the stripped binary SHA-256 matches the sidecar.
5. Capture the stripped process by passing sidecar symbol addresses and list-follow rules to the raw capturer.
6. Decode global and heap state from sidecar layouts.
7. Emit a portable bundle that includes `.machinen-meta.json`.
8. Restore the semantic state into the stripped target.

## Stable mismatch refusal

Before capture, the verifier hashes the target binary and compares it to the sidecar build entry. A mismatch refuses before touching process memory:

```json
{
  "code": "target-build-mismatch",
  "message": "target binary sha256 does not match .machinen-meta.json"
}
```

This keeps stale sidecars from silently decoding the wrong layout.

## Limits

The sidecar proof still uses the controlled fixture and a cooperative safe point. It proves that stripped binaries do not need in-binary DWARF at extraction time, not that arbitrary optimized stacks can be translated. The next continuation work handles stack-frame state more directly.

## Verify

Run on Linux:

```sh
pnpm sidecar-metadata-extract
```

On non-Linux hosts the verifier skips because capture depends on Linux `/proc` and `ptrace`.
