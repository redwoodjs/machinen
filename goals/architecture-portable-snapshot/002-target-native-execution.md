# Goal 002: Target-native execution

GitHub issue: https://github.com/redwoodjs/machinen/issues/812

## Contract

Target execution must be native.

## Motivation

A successful continuation must run as target-native code on the target ISA. Emulation may be useful for diagnostics, but it cannot prove target-native architecture-portable restore.

## Acceptance criteria

- [ ] Every successful continuation row records `targetExecution: native`.
- [ ] Validation rejects `migrationCompleted=true` with emulated or not-applicable execution.
- [ ] Target-side evidence identifies the target machine architecture.
- [ ] Emulated routes stay classified as refused, skipped, or proof-only non-continuation evidence.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
