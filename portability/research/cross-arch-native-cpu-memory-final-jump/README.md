# Track A: CPU, memory, and final-jump proof

This lane is the useful Track A proof after the scalar warm-up. It still uses a tiny declared-safe-point fixture, but it now translates real execution pieces instead of only copying semantic fields.

It remains an experimental harness proof, not product support for arbitrary process restore.

## What it proves

The verifier proves both directions:

- `arm64 -> amd64`
- `amd64 -> arm64`

For each direction it does all six Track A steps:

1. captures source CPU state: `pc`, `sp`, and argument register value
2. captures a declared heap memory region as raw bytes
3. translates source addresses into target addresses with a pointer relocation table
4. rebuilds target-native heap memory and allocates a target stack
5. builds a target CPU plan: target entry symbol, stack pointer, and argument register
6. uses assembly to switch to that target stack/register state and jump into target-native code

The target-native function increments the reconstructed counter and prints:

```text
hello:42
```

## What it refuses

The verifier keeps retained refusal evidence for:

- a bad pointer relocation
- source-ISA emulation being claimed

The restore path also refuses mismatched target architecture, missing safe point, bad source CPU state, unsupported live kernel/runtime state, and claim guards that are not false.

## Hosts

Defaults:

- `friend@100.126.46.90` for `arm64`
- `root@192.168.0.8` for `amd64`

Override with `TRACK_A_ARM64_HOST` and `TRACK_A_AMD64_HOST`.

## Run

```sh
portability/research/cross-arch-native-cpu-memory-final-jump/verify.sh
```

The script writes retained captures, final-jump logs, refusal logs, and `retained/report.json`.
