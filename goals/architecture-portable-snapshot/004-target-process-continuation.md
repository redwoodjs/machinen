# Goal 004: Target process continuation from captured state

GitHub issue: https://github.com/redwoodjs/machinen/issues/814

## Contract

Target process must continue from captured state.

## Motivation

The proof must show the target process used captured state and advanced from it. Merely starting a fresh process or printing expected output is not enough.

## Acceptance criteria

- [ ] Source capture records a verifier-observable state value.
- [ ] Target loader materializes a target-native process with that state.
- [ ] Target verifier proves the next state follows from the captured state.
- [ ] Tests fail if the target ignores or rewrites captured state.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
