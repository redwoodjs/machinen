# Goal 005: Source-ISA emulation refusal

GitHub issue: https://github.com/redwoodjs/machinen/issues/815

## Contract

No source-ISA emulation.

## Motivation

A source-ISA emulator can hide the fact that no translation happened. Successful continuation must not use source-ISA emulation.

## Acceptance criteria

- [ ] Bundle and row expose a source-ISA emulation flag.
- [ ] The flag must be false for success.
- [ ] Validation rejects successful rows that used source-ISA emulation.
- [ ] Negative tests prove emulation cannot set `migrationCompleted=true`.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
