# Native mapping policy proof

This proof checks the native process-image mapping boundary for kernel-supplied
and unreadable mappings.

## Command

```sh
pnpm native-mapping-policy
```

On non-Linux hosts the proof skips because it needs `/proc/<pid>/maps`,
`/proc/<pid>/mem`, and `ptrace`.

## What it proves

The target program is
`packages/microvm/assets/native-mapping-policy-target.c`. It creates a
`PROT_NONE` anonymous page and then spins as an unmodified native process. The
external capturer stops it and emits a native process-image bundle.

A passing run proves:

1. kernel mappings such as `vdso`, `vvar`, or other special mappings are marked
   `target.materialization: "recreate"`;
2. recreated kernel mappings are not copied into `native-memory.bin`;
3. the unreadable `PROT_NONE` mapping refuses with `mapping-unreadable`;
4. the mapping refusal is also present in the bundle-level mapping refusal list.

## Boundary

This does not implement target vdso/vvar reconstruction. It only prevents a bad
restore from copying source kernel pages as normal user memory. The follow-up
[Native mapping materializer](./native-mapping-materializer.md) applies this
policy to target mappings. Real target kernels must supply their own
vdso/vvar/special mappings, and any mapping that cannot be read through
`/proc/<pid>/mem` must remain a precise refusal.
