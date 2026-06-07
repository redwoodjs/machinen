# Native machine restore descriptor

Issue #651 adds a stable descriptor for accepted native machine restore plans.

`buildNativeMachineRestoreDescriptor()` converts an accepted
`NativeMachineRestorePlan` into a versioned JSON descriptor with:

- target thread identity and count;
- signal blocked masks to restore;
- modeled active syscall continuations;
- translated stack-window bounds, guards, and relocation count;
- bounded return-chain frames;
- native mapping materialization steps.

Refused plans cannot produce descriptors. `validateNativeMachineRestoreDescriptor()`
checks the descriptor kind/version and required sections, and JSON
serialization/parsing round-trips deterministically. The descriptor is the next
contract for target descriptor/loader work; it does not by itself perform memory
writes or resume execution.
