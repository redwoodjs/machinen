# Goal 010: Live migration completion gate

GitHub issue: https://github.com/redwoodjs/machinen/issues/820

## Contract

`migrationCompleted=true` only after live opposite-ISA target-native proof.

## Motivation

Fixture mode can validate a bundle, but it cannot complete migration. Completion requires a live target of the opposite ISA running target-native verifier code.

## Acceptance criteria

- [ ] Fixture/local-only runs always keep `migrationCompleted=false`.
- [ ] Live runs require source and target ISA to differ.
- [ ] Live runs require target-native verifier output.
- [ ] Validation rejects refused, skipped, emulated, sidecar, metadata-only, or raw-replay rows with `migrationCompleted=true`.

## Validation

- [ ] Add or update unit tests for this contract.
- [ ] Add or update smoke coverage when behavior is executable.
- [ ] Ensure the architecture-portable snapshot gauntlet enforces this contract.
- [ ] Record validation commands and timings in the implementing PR.
