# Native stack-window materializer

Issue #653 turns a validated stack-window plan into concrete target memory writes.

`materializeNativeStackWindowWrites()` accepts only a `materialized`
`NativeStackWindowMaterializationPlan`. It emits:

- little-endian 64-bit writes for translated return-address, pointer, and
  code-pointer relocations;
- target addresses computed relative to the validated target stack window;
- below/above guard ranges that the target mapper must recreate.

Refused stack-window plans remain refused and cannot produce writes. This keeps
raw source stack bytes out of the success path while giving the target descriptor
and loader exact bytes to place into target-native stack slots.
