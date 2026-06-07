# Native real utility target module bytes

Issue #503 proves target-native byte provenance for real-utility continuation
planning. A mapped target module/RVA is not enough by itself; the bytes to jump
into must come from an explicit amd64 target root or binary inventory.

## Rule

`materializeNativeTargetModuleBytes()` resolves a target module path from an
explicit `targetRoot`, reads the target file, verifies its build identity, checks
that the requested RVA range is executable, and returns only the requested target
bytes.

The function reports:

```json
{
  "sourceTextReusedAsTargetCode": false
}
```

The source process text mapping is never used as the target code source.

## Precise refusals

- `target-module-file-missing` — the target module file was not present in the
  explicit target root/inventory.
- `target-build-id-mismatch` — the target file bytes did not match the expected
  target build identity.
- `target-code-rva-unmapped` — the requested RVA range is not executable in the
  target module metadata.
- `target-module-range-unreadable` — the requested file byte range is outside
  the target file.

## Proof

`pnpm native-real-utility-target-module-bytes --json` creates an explicit target
root containing a target-native amd64 module fixture, verifies its SHA-256 build
identity, materializes the executable RVA range, and emits:

```text
real-utility-target-module-bytes-materialized-from-explicit-target-root
```
