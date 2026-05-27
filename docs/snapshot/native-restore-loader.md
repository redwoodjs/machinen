# Native restore loader proof

Issue #444 adds the first target-side materialization proof for the transparent
native track. It is not the final process zygote yet; it proves the boundary
between a validated native process image and the code that maps target memory.

## Command

```sh
pnpm native-restore-loader
```

To keep the synthetic bundle:

```sh
pnpm native-restore-loader -- --out-dir /tmp/native-loader --keep --json
```

## What it proves

The proof builds `packages/microvm/test-fixtures/proof-assets/native-restore-loader.c`, writes a
synthetic native process image bundle, then asks the helper to:

1. open `native-memory.bin`;
2. map an anonymous target page;
3. copy the requested mapping bytes from the bundle;
4. verify the materialized prefix;
5. apply final page permissions with `mprotect`;
6. emit a materialization event.

The same run also invokes the loader with a missing memory payload and asserts
that the failure names the loader phase (`open memory failed`).

## Boundary

The JavaScript driver owns bundle validation and translation policy. The C
helper owns target address-space materialization. This keeps the later ISA
translation issues separate:

- #445 decides target register/TLS/syscall state;
- #446 decides target code addresses;
- #447 decides target stack layout;
- #448 decides pointer relocations;
- #449 decides resource recipes.

The synthetic bundle still records a cross-ISA source/target pair, but the
translation thread is `pending`. This issue proves mapping materialization, not
register transfer or live continuation.
