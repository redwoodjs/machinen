# Goal 36.6: Concurrent load, repeatability, and failure injection

Parent: [Goal 36](./goal-036.md).

## Objective

Prove the complex Node suite remains reliable while apps are under load, repeated
many times, and exposed to controlled failures.

## Requirements

- [x] Add load generator that drives HTTP/API/database/native-addon paths before,
      during, and after capture.
- [x] Capture at deterministic load checkpoints and record request IDs,
      in-flight operations, acknowledged responses, and target verifier outputs.
- [x] Repeat the complex suite enough times to detect flakes and record pass
      rate, latency distribution, and failure signatures.
- [x] Inject failures such as target dependency unavailable, network reset,
      database reconnect required, native addon artifact mismatch, worker crash,
      and timeout during capture.
- [x] Prove failures either recover within the supported policy or refuse with
      stable codes and `migrationCompleted=false`.
- [x] Audit process, socket, file, temporary directory, and child-process cleanup
      after success and refusal paths.

## Validation

- [x] Concurrent load restore batch.
- [x] Repeatability/flakiness batch with pass-rate threshold.
- [x] Failure-injection restore/refusal matrix.
- [x] Resource cleanup/leak audit.
- [x] Load/failure checked summaries and matrix presets.
- [x] Relevant static checks from Goal 36.

## Completion criteria

Complete when complex Node restores remain repeatable under load and controlled
failures have stable recovery/refusal behavior.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
