# Goal 008: Nested virtualization stretch proof

## Motivation

Nested virtualization is a high-visibility demo, but it is not required for the
portable snapshot product claim. It must remain clearly labeled as stretch/demo
unless the host/provider support model becomes reliable enough for product use.

## Objective

Where available, run and classify a nested virtualization proof without allowing
it to blur product support claims.

## Required proof

- [x] Detect whether nested virtualization is available on the host/provider.
- [x] Run the existing nested-virtualization / Firecracker guide as a stretch
      smoke where available.
- [x] Record L0 host architecture.
- [x] Record L1 guest architecture.
- [x] Record L2 guest architecture.
- [x] Record acceleration vs emulation mode for each layer where known.
- [x] Record verifier output from inside the nested guest.
- [x] Label the result as `stretch-demo` unless product support requirements are
      separately met.

## Snapshot/fork safety rule

Provider-level snapshots/forks must be blocked or refused while a VM has nested
virtualization enabled unless a future goal implements a safe model.

Required:

- [x] refusal code for snapshot/fork with active nested virtualization;
- [x] clear remediation;
- [x] test proving the unsafe path does not silently proceed.

## Machine-readable output

Each row must include:

- `kind: machinen.architecture-portable-snapshot.nested-virtualization-stretch-proof`
- `classification: stretch-demo | refused | skipped`
- `l0HostArch`
- `l1GuestArch`
- `l2GuestArch`
- `providerMode`
- `accelerated`
- `emulated`
- `nestedVerifierOutput`
- refusal code/remediation when refused or skipped

## Non-goals

- Do not make nested virtualization required for portable snapshot support.
- Do not claim nested virtualization as product-supported unless snapshot/fork
  safety is modeled.
- Do not hide emulation behind a native/accelerated label.

## Tests and smokes

- [x] Availability probe.
- [x] Stretch smoke where available.
- [x] Snapshot/fork refusal test for active nested virtualization.
- [x] Summary classification tests.

## Documentation

- [x] Explain why nested virtualization is stretch/demo.
- [x] Explain host/provider prerequisites.
- [x] Explain snapshot/fork refusal while nested virtualization is active.

## Validation

Run and record timing for:

- [x] nested virtualization availability/smoke where available;
- [x] refusal tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
