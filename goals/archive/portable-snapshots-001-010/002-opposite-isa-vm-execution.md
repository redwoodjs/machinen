# Goal 002: Opposite-ISA VM execution proof

## Motivation

Before Machinen can credibly claim cross-architecture restore, it must prove it
can run a guest whose ISA differs from the host ISA and that the observed result
comes from the guest, not from a host sidecar or metadata-only proof.

This is a prerequisite proof, not the full portable snapshot story.

## Objective

Build a repeatable proof that Machinen can run:

- an `amd64` guest on an `arm64` host;
- an `arm64` guest on an `amd64` host where the host/provider supports it.

The proof must label whether execution used hardware assist, emulation, or a
provider-specific mode.

## Required proof

- [x] Boot opposite-ISA guest VM when the provider route is available; otherwise
      emit a stable skipped summary.
- [x] Record host architecture.
- [x] Record guest architecture.
- [x] Record provider/accelerator mode.
- [x] Record kernel version for completed live or fixture routes.
- [x] Record rootfs digest for completed live or fixture routes.
- [x] Record whether execution used hardware assist or emulation.
- [x] Verify inside the guest with `uname -m` for completed live or fixture
      routes.
- [x] Verify an ELF binary compiled for the guest architecture executes inside
      the guest for completed live or fixture routes.
- [x] Verify output comes from the guest, not a host sidecar.

## Machine-readable output

Each route summary must include:

- `kind: machinen.architecture-portable-snapshot.opposite-isa-vm-execution`
- `hostArch`
- `guestArch`
- `providerMode`
- `accelerated`
- `emulated`
- `kernelVersion`
- `rootfsDigest`
- `guestUnameMachine`
- `guestElfMachine`
- `verifierOutput`
- `state: completed | refused | skipped`
- refusal code and remediation when unavailable

## Refusals / skips

Refuse or skip with stable wording when:

- the host/provider cannot boot the requested guest ISA;
- required kernel/rootfs assets are missing;
- the verifier cannot prove guest-side execution;
- the route would rely on a host-side sidecar for the proof.

## Tests and smokes

- [x] Unit tests for summary classification.
- [x] Smoke for `amd64` guest on `arm64` host.
- [x] Smoke for `arm64` guest on `amd64` host where available.
- [x] Negative proof that host-side architecture output is not accepted.

## Documentation

- [x] Document supported host/guest route matrix.
- [x] Explain acceleration vs emulation labels.
- [x] Explain why this proof is necessary but not sufficient for restore.

## Validation

Run and record timing for:

- [x] targeted opposite-ISA VM execution smoke;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.

## Completion record

Implemented on branch `goal-002-opposite-isa-vm-execution`.

Proven on the current host:

- Host architecture was `arm64`; requested guest architecture was `amd64`.
- The current provider route was classified as
  `darwin-hvf-opposite-isa-unsupported` with `accelerated=false` and
  `emulated=false`.
- The live route summary was `state=skipped` with
  `refusalCode=opposite-isa-provider-unavailable`; no opposite-ISA VM boot was
  claimed on this host.
- The completed guest-exec fixture records `guestUnameMachine=x86_64`,
  `guestElfMachine=ELF 64-bit LSB executable, x86-64`, a fixture kernel version,
  a rootfs digest, `emulated=true`, and `state=completed`.
- The negative host-side fixture is refused with
  `opposite-isa-host-sidecar-output`, proving host `uname` output is not accepted
  as guest proof.

Not proven on the current host:

- No actual `amd64` guest booted on this `arm64` macOS/HVF host.
- No actual `arm64` guest booted on an `amd64` host; that smoke is available via
  the same script on an amd64 provider.
- No hardware-assisted opposite-ISA execution was observed.
- No real CPU emulation backend was exercised; only an explicit fixture labels
  the completed shape as emulated.
- This proof does not preserve or restore process/kernel state.

Validation timings:

- `pnpm run format:check` — passed in 1.280s after the final edits.
- `pnpm run lint` — passed in 0.201s.
- `pnpm run build:docs` — passed in 1.627s.
- `pnpm run typecheck` — passed in 2.427s.
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/opposite-isa-vm-execution.test.ts` — passed in 0.575s.
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — passed in 49.081s.
- `pnpm run smoke-opposite-isa-vm-execution` — passed in 1.207s.
- `OPPOSITE_ISA_VM_LIVE=1 pnpm run smoke-opposite-isa-vm-execution` — passed in
  1.171s with the live route skipped as provider-unavailable.
- `pnpm exec fallow audit --changed-since origin/main` — passed after commit in
  0.373s.
