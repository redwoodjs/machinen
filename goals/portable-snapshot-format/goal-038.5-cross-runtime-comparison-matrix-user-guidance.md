# Goal 38.5: Cross-runtime comparison matrix and user guidance

Parent: [Goal 38](./goal-038.md).

## Objective

Publish a comparison matrix for non-Node runtime restore readiness and recommend
which runtime envelope should be expanded next.

## Requirements

- [x] Add a cross-runtime matrix comparing JVM, Python, Ruby, and Go support or
      refusal status.
- [x] Record supported subsets, refusal families, target-native requirements,
      native-extension boundaries, persistence/network/threading boundaries, and
      next recommended proof expansion.
- [x] Update runtime manifests and support-envelope docs.
- [x] Add checked summaries or proof profiles for every runtime status recorded
      in the comparison.
- [x] Include user-facing guidance that avoids overstating unsupported runtimes.

## Validation

- [x] Cross-runtime comparison matrix command or checked summary.
- [x] Runtime support matrix validation.
- [x] Docs validation.
- [x] Relevant static checks from Goal 38.

## Completion criteria

Complete when the project has clear, proof-backed, user-facing guidance for JVM,
Python, Ruby, and Go runtime restore readiness.

## Completion record

Completed with `scripts/non-node-runtime-proof.mjs`, `scripts/smoke/non-node-runtime-proof.sh`, non-Node checked summaries, runtime manifest updates, proof profiles, matrix presets, and user guidance in `docs/snapshot/non-node-runtime-restore-claims.md`. Final validation passed on 2026-05-25.
