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

## Special-mapping inventory and policy

Accepted proof bundles currently observe these special mapping families:

| Source mapping                                         | Target policy                          | Copy source bytes? | Reason / refusal path                                                                                                                         |
| ------------------------------------------------------ | -------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `[vdso]` / `vdso`                                      | target-owned recreate/verify only      | no                 | target kernel supplies vDSO code and address; source vDSO is never target code                                                                |
| `[vvar]` / `vvar`                                      | target-owned recreate/verify only      | no                 | target kernel supplies time data pages                                                                                                        |
| other kernel `special` mappings                        | target-owned recreate/verify or refuse | no                 | kernel semantics must be explicit before use                                                                                                  |
| stack/heap/file `PROT_NONE` guards                     | recreate as no-access guard            | no                 | preserves fault boundary without copying unreadable bytes                                                                                     |
| executable source text                                 | map target-native file only            | no                 | requires target build-id/sha256/path provenance                                                                                               |
| unreadable shared/writable/executable ambiguous ranges | refuse                                 | no                 | `mapping-unreadable`, `mapping-shared-unsupported`, `mapping-executable-unsupported`, or `mapping-permission-unsupported` with mapping detail |

This does not implement target vDSO/vvar byte reconstruction. It only prevents a
bad restore from copying source kernel pages as normal user memory. The follow-up
[Native mapping materializer](./native-mapping-materializer.md) applies this
policy to target mappings. Real target kernels must supply their own
vDSO/vvar/special mappings. Unreadable mappings that are writable, executable,
shared, or otherwise ambiguous still remain precise refusals with mapping
details.

Target-native verification for modeled special mappings is limited to verifying
that target-owned mappings exist and are not sourced from the captured
`native-memory.bin`. Data-dependent vDSO/vvar semantics stay unsupported until a
future target-kernel contract models them explicitly.
