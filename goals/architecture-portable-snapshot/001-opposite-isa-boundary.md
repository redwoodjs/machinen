# Goal 001: Opposite ISA boundary

GitHub issue: https://github.com/redwoodjs/machinen/issues/811

## Contract

Source and target ISA must differ.

## Motivation

A continuation cannot count as architecture-portable if it restores back onto the same ISA. Same-ISA restore can be useful, but it is a different claim.

## Acceptance criteria

- [ ] Every continuation row records `sourceArch` and `targetArch`.
- [ ] Validation fails when `sourceArch === targetArch`.
- [ ] Same-ISA fixtures are allowed only as fixtures or separate same-ISA claims.
- [ ] Docs explain why this boundary is required.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
