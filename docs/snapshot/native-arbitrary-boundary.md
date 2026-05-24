# Native arbitrary-binary support boundary

Issue #452 defines when the project may claim transparent native cross-ISA
support for arbitrary binaries.

## Command

```sh
pnpm native-boundary-check
```

The check verifies that every known ambiguity class has required metadata and a
stable refusal code.

## Claim criteria

A target can be called supported only when every item below has either a proven
translation rule or an explicit refusal in the bundle:

1. pointer-shaped words are classified as pointer/code-pointer/thread-pointer or
   integer;
2. return addresses are mapped through source/target code identity;
3. every stack frame has unwind/DWARF/sidecar metadata;
4. no thread is stopped in an active syscall/restart block unless that state is
   modeled;
5. no signal trampoline/alt-stack frame is active unless decoded;
6. TLS, rseq, and futex state are modeled;
7. target executable/library build identity is checked;
8. kernel resources have reopen/broker recipes or precise refusals;
9. vdso/vvar/special mappings are recreated or refused;
10. JIT/self-modifying code has runtime metadata or is refused.

## Stack, register, and code-identity boundary

The current accepted native-transparent class keeps the target execution point
bounded by metadata-proven translated frames:

| State                             | Required proof or refusal                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| source/target executable code     | target build-id/sha256/path provenance and translated code map; otherwise refuse                                                                     |
| return chain                      | target unwind provenance for every frame; missing or non-target provenance refuses                                                                   |
| frame/register state              | translated target frame pointer, stack pointer, instruction pointer, RFLAGS, TLS/TCB, and modeled callee-saved slots; missing or unsafe slots refuse |
| pointer-shaped stack/heap words   | classified as pointer, code pointer, thread pointer, or integer through metadata; ambiguous values refuse                                            |
| stack frame metadata              | DWARF/sidecar/unwind metadata required for every accepted frame; optimized-away/missing metadata refuses                                             |
| JIT or self-modifying code        | refused until runtime code provenance and invalidation rules are modeled                                                                             |
| signal trampoline/alt-stack frame | refused unless decoded by a future signal-frame model                                                                                                |

## No overclaiming

Controlled proofs do not imply arbitrary binary support. A future PR that claims
support for a new target class must include the checklist output and show how
each ambiguity class is translated or refused.

## Current boundary

The current native track proves format validation, external capture, target
memory materialization, register safe-point translation, code-location mapping,
stack relocation, memory relocation, resource recipes/refusals, a controlled
native final jump, a captured-process native final jump, a captured jump into a
matching amd64 target-binary continuation, a translated call-frame return through
matching amd64 target-binary code, a translated heap/global pointer graph walked
natively after that return, captured regular-file fd read/write/vector proof
slices, bounded process context, target private-memory restore, special-mapping
refusals, target fd-table/resource gates, a hard refusal matrix for
syscall/signal/rseq thread states, a mapping policy proof for kernel/unreadable
mappings, and target-native remote proof profiles. It still does not claim
generic final instruction-pointer jump for arbitrary optimized binaries.
