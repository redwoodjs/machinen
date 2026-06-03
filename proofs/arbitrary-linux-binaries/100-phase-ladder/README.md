# Arbitrary process proof/classification phase ladder

Status: `verified`

This retained ladder defines phases 1–7 for proof/classification coverage with product support explicitly out of scope. It does **not** raise the public claim.

## Current public claim

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Phase rows

| Proof                 | Phase                         | Target            | Current status |
| --------------------- | ----------------------------- | ----------------- | -------------- |
| `arbitrary-phase/001` | selected seed product path    | `1 / 1 / 1`       | `blocked`      |
| `arbitrary-phase/002` | controlled process corpus     | `5 / 5 / 1`       | `proof-only`   |
| `arbitrary-phase/003` | memory/linker/signal coverage | `20 / 20 / 5`     | `proof-only`   |
| `arbitrary-phase/004` | process tree, IPC, resources  | `40 / 40 / 10`    | `defined`      |
| `arbitrary-phase/005` | threads/futex safe subset     | `60 / 60 / 20`    | `blocked`      |
| `arbitrary-phase/006` | broad Linux binary corpus     | `80 / 80 / 50`    | `not-started`  |
| `arbitrary-phase/007` | final 100 gate                | `100 / 100 / 100` | `not-started`  |

## Retained artifact

- `retained/arbitrary-process-100-phase-ladder-report.json`
