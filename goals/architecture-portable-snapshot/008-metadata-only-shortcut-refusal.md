# Goal 008: Metadata-only shortcut refusal

GitHub issue: https://github.com/redwoodjs/machinen/issues/818

## Contract

No metadata-only shortcut counted as success.

## Motivation

A manifest that says continuation happened is not proof that a target process continued. Metadata must be backed by target execution.

## Acceptance criteria

- [ ] Successful rows include target process verifier output.
- [ ] Metadata-only continuation is classified as refused.
- [ ] Validation rejects `migrationCompleted=true` without target verifier evidence.
- [ ] Negative smoke proves metadata-only success cannot complete migration.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
