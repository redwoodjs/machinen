# Goal 009: Unsupported state refusal inventory

GitHub issue: https://github.com/redwoodjs/machinen/issues/819

## Contract

Unsupported state must be refused, not ignored.

## Motivation

Architecture-portable continuation must account for state. Files, sockets, threads, signals, timers, dynamic libraries, runtime-private state, and advanced Linux facilities must be modeled or refused.

## Acceptance criteria

- [ ] Each profile includes an unsupported-state inventory.
- [ ] Unsupported categories carry stable refusal codes and remediation.
- [ ] Validation fails if required state categories are missing.
- [ ] Tests cover happy paths and refusal paths for the profile state model.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
