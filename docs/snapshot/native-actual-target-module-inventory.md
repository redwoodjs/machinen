# Native actual target module inventory

Issue #518 adds explicit target module inventory for actual real-utility paths.

## Default behavior

The inventory returns no modules unless a caller provides either:

- an explicit target root, such as an amd64 filesystem root; or
- an explicit target executable path.

This prevents an arm64 host path from being reused accidentally as amd64 target
code.

## Cross-ISA path mapping

When an amd64 target root is provided, common Debian/Ubuntu multiarch paths are
mapped from source to target:

- `aarch64-linux-gnu` -> `x86_64-linux-gnu`;
- `/usr/bin/<tool>` remains `/usr/bin/<tool>` inside the target root;
- dynamic loader paths use target-arch loader candidates such as
  `/lib64/ld-linux-x86-64.so.2`.

Each discovered target module records target-native bytes, a deterministic target
load bias, and an executable RVA range. Source text is never used as target code.

## Actual utility effect

With explicit sleep deferral and an amd64 target root, the actual `/bin/sleep`
proof can move past the previous `target-module-missing` blocker for libc,
materialize target-native libc bytes, and expose the next `source-unwind` gate.
If no target root is supplied, the proof still fails closed with
`target-module-missing`.

## Boundary

This is inventory only. It does not resume the process, parse target loader
state, or prove that arbitrary source and target libc RVAs are semantically
equivalent.
