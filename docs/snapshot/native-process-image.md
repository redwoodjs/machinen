# Transparent native process image format

Issue #441 targets transparent **native** cross-ISA live process migration:

```text
arm64 Linux process -> external capture -> translate -> native amd64 process
```

This is intentionally different from the cooperative runtime-adapter work and
from restoring source-ISA code under emulation. The captured program does not
call a checkpoint hook, and success means the target resumes as target-native
code.

## Bundle files

A native process image bundle contains these files:

| File                      | Purpose                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `native-process.json`     | Capture method, source ISA, target ISA, argv/env/cwd, and top-level refusals.                               |
| `native-mappings.json`    | Source memory mappings, raw-memory offsets, permissions, file identity, and target materialization policy.  |
| `native-threads.json`     | Per-thread stop state, source registers, syscall state, signal state, TLS, and rseq state.                  |
| `native-resources.json`   | Kernel resources such as fds, files, sockets, PTYs, timers, namespaces, credentials, and futex/epoll state. |
| `native-translation.json` | Target-native translation plan for code locations, thread registers, and memory relocations.                |
| `native-memory.bin`       | Raw bytes captured from readable source mappings.                                                           |

JSON schemas are exported from `nativeProcessImageSchemas`. The validator reads
all JSON files and requires `native-memory.bin` for bundle validation.

## Raw capture vs translated target state

The format keeps source and target state in separate sections:

- source memory bytes live only in `native-memory.bin` and are referenced by
  `native-mappings.json` `captured` ranges;
- source registers live under `native-threads.json` `sourceRegisters`;
- target register state, code addresses, and pointer relocations live under
  `native-translation.json`.

This prevents accidental raw restore. An arm64 `pc`, stack pointer, return
address, or pointer-like word is never considered valid amd64 state unless a
translation entry proves it.

## Safe failure is part of the format

Every document has a refusal vocabulary. Current stable refusal codes cover the
first native-translation blockers:

- `active-syscall`
- `signal-frame-active`
- `tls-state-unsupported`
- `rseq-state-unsupported`
- `futex-state-unsupported`
- `mapping-ambiguous`
- `mapping-unreadable`
- `code-location-unknown`
- `pointer-ambiguous`
- `resource-kind-unsupported`
- `target-build-mismatch`
- `target-build-id-mismatch`
- `target-module-missing`
- `target-module-not-executable`
- `target-code-location-unresolved`
- `target-code-rva-unmapped`
- `unwind-metadata-missing`
- `unwind-fde-missing`
- `unwind-rule-unsupported`
- `return-slot-unreadable`
- `target-unwind-mismatch`

Unsupported work must emit a precise refusal instead of silently copying source
state into the target.

## Non-goals

- No Node/Bun/app sidecars.
- No source-level checkpoint ABI.
- No source-ISA emulation as the success result.
- No arbitrary-binary support claim until code pointers, stack frames, TLS,
  signal/syscall state, libc state, and kernel resources are either translated
  or refused precisely.

## First proof

The initial proof is schema/validator level:

- a hand-written single-thread arm64 -> amd64 image validates;
- missing architecture-specific register metadata fails;
- missing mapping references fail;
- same-ISA "cross-ISA" target sections fail;
- bundle validation requires the raw memory payload.

Later issues fill in the capturer, loader, register translation, stack/memory
translation, and kernel-resource recipes.
