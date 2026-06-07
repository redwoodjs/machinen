# Track A Lane 1: Native scalar safe-point E2E

This lane is the first Track A proof. It continues a selected native C workload across `arm64 <-> amd64` at a declared safe point by capturing semantic scalar state into Continuation IR and restoring it through a target-native C binary.

It is an experimental harness proof, not product support for arbitrary Linux process restore.

## Shared hosts

The default hosts are:

- `friend@100.126.46.90` for `arm64`
- `root@192.168.0.8` for `amd64`

Override them with `TRACK_A_ARM64_HOST` and `TRACK_A_AMD64_HOST`.

## What is proven

`verify.sh` performs both directions:

1. compile the fixture on `arm64`
2. capture `arm64 -> amd64` Continuation IR at `after_increment`
3. compile the fixture on `amd64`
4. restore the IR by calling the `amd64` target-native `continue_from_safepoint`
5. repeat the same flow for `amd64 -> arm64`

The expected target output in both directions is:

```text
hello:42
```

## Claim boundaries

The lane refuses unsupported state instead of broadening the claim. The verifier checks refusals for:

- active syscall
- threads
- socket state
- source-ISA emulation
- metadata-only success
- unsupported stack frame
- target architecture mismatch
- missing declared safe point

The retained report keeps the claim guards false:

- `arbitraryProcessRestoreClaimed`
- `rawVmReplayUsed`
- `sourceIsaEmulationUsed`
- `metadataOnlySuccess`

## Run

```sh
portability/research/cross-arch-native-safepoint-scalar/verify.sh
```

The script writes retained captures, restore logs, refusal logs, and `retained/report.json`.
