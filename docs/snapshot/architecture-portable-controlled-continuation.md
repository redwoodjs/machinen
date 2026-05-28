# Architecture-portable controlled C continuation

This proof is the first architecture-portable snapshot translation row. It uses a
small controlled C counter with an explicit safe point, captures logical state on
one ISA, restores it on the opposite ISA with a provenance-checked target-native
binary, and requires target-side verifier output.

It is not arbitrary Linux process restore. It does not replay a raw checkpoint
image, source VM memory, source registers, or source stack frames.

## Bundle contract

The bundle contains:

- `manifest.json` — format version, source/target architecture, state model,
  target artifact provenance, verifier contract, forbidden shortcut flags, and
  stable digests for restore-affecting bundle projections.
- `state.json` — the continuation label, captured counter, and next counter.
- `refusals.json` — unsupported state categories for this profile: files,
  sockets, threads, signals, timers, dynamic libraries, and runtime-private
  state.
- `target.env` — a shell-readable projection used by the target loader, covered
  by the manifest digest map.
- `target/controlled-counter-<arch>` — the target-native C artifact.

The state model is `translated-controlled-continuation`. The bundle validator
fails closed if `manifest.json`, `state.json`, `refusals.json`, `target.env`, or
the target artifact is missing or tampered.

## Target restore loader

`scripts/architecture-portable-controlled-continuation-target-loader.sh` runs on
the target host. It verifies:

- `uname -m` matches the requested target architecture;
- the target binary digest matches the manifest projection;
- target artifact provenance metadata is present and projected to the loader;
- forbidden shortcuts are disabled;
- the target-native binary emits `target-native-continuation-ok`;
- `restoredCounter` equals `capturedCounter + 1`.

## Fixture mode vs live mode

Fixture mode builds and validates the bundle locally, but it does not run an
opposite-ISA target. It must keep `migrationCompleted=false`.

Live mode requires a real opposite-ISA SSH target, for example:

```sh
pnpm run smoke-architecture-portable-controlled-continuation -- --live \
  --target-ssh root@192.168.0.8
```

Only live mode may set `migrationCompleted=true`.

## Actual continuation contract

A completed row must be opposite-ISA, target-native, and backed by target verifier
output. The verifier must include the source architecture, target architecture,
captured counter, restored counter, and `target-native-continuation-ok`. The
restored counter must equal `capturedCounter + 1`.

Completed rows are rejected if they used source-ISA emulation, raw checkpoint
replay, sidecar-only output, or metadata-only continuation. Refused and skipped
rows can never set `migrationCompleted=true`.

## What this proves

A successful live row proves a controlled C workload continued from portable
state on the opposite ISA with target-native execution. The verifier output comes
from the target host and includes the restored counter value.

## What this does not prove

This does not prove arbitrary process memory translation, raw checkpoint replay,
active socket restore, thread restore, pending signal restore, timer restore, or
dynamic library state restore. Those categories remain refused until explicitly
modeled.
