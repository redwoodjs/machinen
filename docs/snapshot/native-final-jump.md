# Native final-jump proof

This proof adds the first target-native execution step after the controlled native
restore pipeline. The follow-up captured-process proof starts from a real
ptrace/procfs arm64 source bundle instead of a fully synthetic image.

## Command

```sh
pnpm native-final-jump
```

On non-Linux/amd64 hosts the proof skips because the target code is amd64
machine code and must run natively. The skip is intentional; running it under
source-ISA emulation would not prove the transparent native goal.

## What it proves

The proof builds `packages/microvm/assets/native-resume-trampoline.c`, writes a
controlled arm64 -> amd64 native process image, and asks the trampoline to:

1. map the translated amd64 text page at its target virtual address;
2. map the translated data page at its target virtual address;
3. install a fresh target stack mapping;
4. jump to the translated amd64 continuation address;
5. pass the relocated target data pointer in the amd64 argument register;
6. verify that the target code writes a marker and observes an `rsp` inside the
   target stack.

The target code is a tiny amd64 function stored in `native-memory.bin`. It is not
called through an arm64 emulator. It runs as native amd64 code on the target host.

## Boundary

This is still a controlled proof. It does not claim arbitrary binary resume.
The input has sidecar metadata for the continuation, stack frame, pointer-bearing
register, and pointer-bearing memory word. The captured-process final-jump proof
keeps those sidecar facts but replaces the synthetic source state with a real
external Linux process capture. If those facts are missing in a real program,
restore must still refuse with the existing precise ambiguity codes.

The proof advances the boundary from:

```text
materialized-translated-state-without-final-jump
```

to:

```text
jumped-target-native-amd64-code
```
