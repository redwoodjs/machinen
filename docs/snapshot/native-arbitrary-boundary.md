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
natively after that return, a captured regular-file fd reopened before
target-native code reads it, and first real utility attempts. It still does not
claim generic final instruction-pointer jump for arbitrary optimized binaries.
