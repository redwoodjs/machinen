# Goal 007: Sidecar output refusal

GitHub issue: https://github.com/redwoodjs/machinen/issues/817

## Contract

No sidecar output counted as success.

## Motivation

A host sidecar can fake expected output without proving target process continuation. Verifier output must come from the target process/target host path.

## Acceptance criteria

- [ ] Successful rows identify the target-side verifier command.
- [ ] Sidecar-only output is classified as refused.
- [ ] Negative smoke proves sidecar output cannot complete migration.
- [ ] Docs explain the difference between target verifier output and host helper output.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
