# Goal 34.9: User-facing Node restore workflow

Parent: [Goal 34](./goal-034.md).

## Objective

Provide and validate a user-facing workflow that takes a user's Node app,
snapshots it, restores it on amd64, and verifies it.

## Requirements

- [x] Define the user-facing command or documented command sequence.
- [x] Accept a Node app path, package metadata, start command, and verifier.
- [x] Capture the app as a live process.
- [x] Generate the portable bundle.
- [x] Restore on amd64 target.
- [x] Run post-restore verifier.
- [x] Surface stable, understandable refusal codes when unsupported state is
      found.
- [x] Document prerequisites, source/target host setup, limitations, and artifact
      locations.
- [x] Add an end-to-end example using the production-shaped service from Goal
      34.1.

## Validation

- [x] User-facing workflow smoke.
- [x] Docs command copy/paste validation.
- [x] Failure-mode validation for unsupported app states.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when a user can follow documented commands to snapshot, restore, and
verify a Node app on amd64, and the workflow has automated smoke coverage.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
