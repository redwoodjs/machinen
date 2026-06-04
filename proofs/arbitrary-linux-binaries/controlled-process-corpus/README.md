# Controlled process corpus matrix

Status: `verified`

Proof: `arbitrary/019`

Scope: `controlled-process-proof-corpus-v1`

This retained matrix expands the selected arbitrary-process seed into a 10-row controlled process proof corpus. Product support is explicitly out of scope.

## Rows

| Row                                           | Disposition       |
| --------------------------------------------- | ----------------- |
| `controlled-argv-env-cwd-binary`              | `supported-proof` |
| `controlled-static-data-heap-mutation-binary` | `supported-proof` |
| `controlled-regular-file-fd-binary`           | `supported-proof` |
| `controlled-simple-pipe-binary`               | `supported-proof` |
| `controlled-idle-tcp-epoll-binary`            | `supported-proof` |
| `controlled-mixed-selected-resource-binary`   | `supported-proof` |
| `controlled-thread-binary-refusal`            | `refused`         |
| `controlled-jit-executable-mmap-refusal`      | `refused`         |
| `controlled-active-syscall-refusal`           | `refused`         |
| `controlled-process-tree-refusal`             | `refused`         |

## Claim effect

No public claim change:

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifact

- `retained/controlled-process-corpus-matrix-report.json`
