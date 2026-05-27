# Goal 34.6: Operational repeatability and flake detection

Parent: [Goal 34](./goal-034.md).

## Objective

Prove the live Node restore workflow is repeatable and not a one-off pass.

## Requirements

- [x] Add a repeatability runner for the live Node restore smoke.
- [x] Run enough iterations to expose obvious flakes.
- [x] Record per-iteration route, timing, profile counts, and failures.
- [x] Preserve failure artifacts for any failed iteration.
- [x] Add threshold policy for acceptable pass rate; default should be 100% for
      required support claims.
- [x] Make repeatability results easy to run locally and on dedicated hosts.

## Validation

- [x] Repeatability batch run for live Node restore.
- [x] Test that a failed iteration fails the batch summary.
- [x] Timing and artifact retention proof.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when repeated live Node restore runs pass according to the threshold and
failure reporting is validated.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
