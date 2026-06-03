# Selected arbitrary Linux process next proof matrix

Status: `verified`

Scope: `selected-arbitrary-linux-process-seed-v1`

This retained proof-only matrix covers the next arbitrary-process rows `arbitrary/009` through `arbitrary/018`.

## Rows

| Proof           | Row                                    | Disposition    |
| --------------- | -------------------------------------- | -------------- |
| `arbitrary/009` | bidirectional architecture matrix      | `proof-only`   |
| `arbitrary/010` | tiny native source capture fixture     | `proof-only`   |
| `arbitrary/011` | target reconstruction verifier         | `proof-only`   |
| `arbitrary/012` | memory map materialization proof       | `proof-only`   |
| `arbitrary/013` | register/stack/bootstrap boundary      | `proof-only`   |
| `arbitrary/014` | signal frame / active syscall refusals | `refused`      |
| `arbitrary/015` | dynamic linker/shared library boundary | `proof-only`   |
| `arbitrary/016` | process tree refusal proof             | `refused`      |
| `arbitrary/017` | selected seed evidence index           | `proof-only`   |
| `arbitrary/018` | candidate claim decision row           | `claim-locked` |

## Claim effect

No public claim change:

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

The candidate `1%` row remains non-public and locked. Product support rows added remains `0`.

## Retained artifact

- `retained/selected-arbitrary-process-next-proof-matrix-report.json`
