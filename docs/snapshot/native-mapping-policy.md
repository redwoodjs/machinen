# Native mapping policy proof

This proof checks the native process-image mapping boundary for kernel-supplied
mappings and no-access guard mappings.

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
3. private unreadable `PROT_NONE` guard/protection mappings are also marked
   `target.materialization: "recreate"`;
4. the recreated protection mappings are not copied into `native-memory.bin`.

## Boundary

This does not implement target vdso/vvar reconstruction. It only prevents a bad
restore from copying source kernel pages as normal user memory. The follow-up
[Native mapping materializer](./native-mapping-materializer.md) applies this
policy to target mappings. Real target kernels must supply their own
vdso/vvar/special mappings. Unreadable mappings that are writable, executable,
shared, or otherwise ambiguous still remain precise `mapping-unreadable`
refusals with mapping details.
