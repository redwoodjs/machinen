# Goal 003: Architecture-portable snapshot bundle

GitHub issue: https://github.com/redwoodjs/machinen/issues/813

## Contract

State must come from an architecture-portable snapshot bundle.

## Motivation

A continuation must be driven by explicit portable state, not implicit host memory, source VM memory, or ad hoc target setup.

## Acceptance criteria

- [ ] Bundle contains manifest, state payload, target artifact provenance, verifier contract, refusal records, and stable digests.
- [ ] Bundle validator fails closed on missing or malformed required files.
- [ ] Restore code consumes the bundle as the source of continuation state.
- [ ] Docs list every restore-affecting file and digest.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
