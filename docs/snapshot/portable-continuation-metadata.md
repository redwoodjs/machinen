# Portable continuation metadata research

## Choice for the next prototype

Use explicit compiler-visible safepoints first. A portable workload marks a safe
function, names the continuation id, and passes live semantic roots to the
checkpoint ABI. Restore calls a target restore trampoline for that continuation
instead of rebuilding a raw source stack.

LLVM stack maps and patchpoints are still useful research tools, especially for
finding live values in optimized C/Rust/Zig code. They are not the first target
because their encoding and optimization behavior vary by frontend, inlining, and
backend. DWARF call-frame/location metadata is broader but was designed for
debuggers, not reliable restart after cross-ISA translation.

## Prototype shape

The proof workload now has `--nested-continuation`. It checkpoints from
`machinen_portable_nested_checkpoint`, records a `nested-live` semantic stack
root, writes `nested-continuation` in the manifest features, and restores through
`machinen_portable_nested_restore_entry` via `machinen_restore_main`.

This demonstrates a non-top-level continuation without copying the source stack:
the target process rebuilds the semantic state, then calls the named target
trampoline with the recorded live value.

## Limitations

- Optimized code can move, inline, or delete locals unless the safepoint contract
  makes them explicit roots.
- Volatile registers and raw return addresses are not portable roots.
- Inlined frames need a logical continuation id, not a physical frame address.
- Language runtimes may provide better continuation metadata than generic C ABI
  roots.
- Stack maps remain a candidate for automatically discovering roots, but the
  portable bundle should keep the same semantic root/continuation format.
