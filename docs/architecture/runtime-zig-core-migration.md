# Runtime Zig core migration boundary

`@machinen/runtime` keeps the public TypeScript API stable, but runtime systems logic should live in the native helper under `packages/runtime/native`.

## TypeScript shell

TypeScript may keep:

- public API types and exported functions
- path resolution and host existence checks needed for user-facing errors
- lifecycle orchestration, process spawning, streams, timers, and registry writes
- command-specific wrappers under `packages/runtime/src/native/`

Product modules must not call `callRuntimeHelper` directly. They should call a wrapper in `packages/runtime/src/native/` so each helper command has one typed TypeScript boundary.

## Zig native core

Zig owns deterministic and low-level runtime behavior behind `machinen-runtime-helper` commands:

- filesystem/archive/image builders
- host probes and process primitives
- boot/provision/snapshot planning
- native process proof planners as they migrate

The helper uses strict JSON stdin/stdout envelopes with `protocolVersion: 1`.

## Guardrail

`pnpm run lint` runs `scripts/runtime-native-boundary-check.mjs`. The check fails when:

- a non-wrapper product module references `callRuntimeHelper`
- a wrapper re-exports `callRuntimeHelper`
- an `@machinen/native-*` package stops advertising the required host binaries

Run it directly with:

```sh
pnpm run runtime-native-boundary-check
```

## Native package payload

Each `@machinen/native-*` host package must expose these spawned host binaries through `package.json#bin` and `index.mjs`:

- `machinen-vm`
- `machinen-runtime-helper`
- `machinen-pdeathsig`
- `machinen-pty`
- `machinen-winsize`
- `gvproxy`
- `mke2fs`
- `mksquashfs`

The runtime helper binary carries command migrations; adding a helper command does not require a new package-level binary export.
