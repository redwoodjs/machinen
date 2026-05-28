# Goal 006: Raw checkpoint replay refusal

GitHub issue: https://github.com/redwoodjs/machinen/issues/816

## Contract

No raw checkpoint replay.

## Motivation

Raw source checkpoint images are architecture-specific. Replaying one across ISA is not architecture-portable snapshot restore.

## Acceptance criteria

- [ ] Bundle and row expose a raw checkpoint replay flag or decision.
- [ ] The flag must be false for success.
- [ ] Validation rejects successful rows that replay raw source checkpoint images.
- [ ] Guest checkpoint artifacts remain proof inputs only unless translated or logically restored.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
