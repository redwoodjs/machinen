# Node Level 5 next claim milestone

This milestone defines what must be true before Machinen can raise the current Node Level 5 product claims beyond `80 / 20 / 0`.

## Current claim

| Claim                                        | Current value | Meaning                                                                            |
| -------------------------------------------- | ------------: | ---------------------------------------------------------------------------------- |
| Node product support                         |           80% | Selected Node service/app families have product-path evidence.                     |
| Broad Node product support                   |           20% | Broad Node remains partial and limited to proven app rows plus refusal boundaries. |
| Arbitrary process cross-architecture restore |            0% | Machinen does not claim arbitrary process restore.                                 |

## Proposed next target

| Claim                                        | Candidate target | Required posture                                                                        |
| -------------------------------------------- | ---------------: | --------------------------------------------------------------------------------------- |
| Node product support                         |              85% | Add one new product-supported family with real VM snapshot evidence in both directions. |
| Broad Node product support                   |              25% | Add broader ecosystem evidence without weakening refusal boundaries.                    |
| Arbitrary process cross-architecture restore |               0% | Stay at zero. No arbitrary process claim is allowed.                                    |

This is a candidate target only. The claim does not change until every gate below is implemented, retained, and release-gated. Current implementation work may add candidate corpus rows and release-gate wiring, but those rows keep `claimChangeAllowed: false` until the evidence gates all pass.

## Milestone family: detected Node VM workload

The next family should prove the generic VM-first product path, not a Node-only selector:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Machinen must detect the supported Node workload inside the VM and retain the evidence. Users must not pass `node` or a host PID on the product path.

## Required positive evidence

| Evidence                   | Requirement                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Generic product command    | Snapshot uses `machinen snapshot <vm-name> --out <dir>`.                                |
| Whole-VM capture           | Snapshot captures VM state, root disk state, and retained workload evidence.            |
| Node detection             | Detection happens inside the VM from the running workload.                              |
| Restore path               | Restore uses `machinen restore <dir>`.                                                  |
| Target-native verification | Restored behavior is verified target-natively.                                          |
| Cross-architecture lanes   | Both `arm64 -> amd64` and `amd64 -> arm64` pass.                                        |
| Artifact retention         | Bundle keeps manifests, logs, verifier output, Node detection report, and refusal rows. |
| Repeatability              | Release gate passes with a zero flake budget.                                           |

## Required refusal evidence

| Boundary                           | Expected result                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Host PID product targeting         | Refused or hidden unless `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1` is set for harnesses. |
| Node-only product selector         | Not part of the public product path.                                                            |
| Active requests                    | Refused before restore claim.                                                                   |
| Worker threads                     | Refused.                                                                                        |
| Native addons                      | Refused.                                                                                        |
| Wasm / external memory             | Refused.                                                                                        |
| TLS active state                   | Refused.                                                                                        |
| Child processes                    | Refused.                                                                                        |
| Source ISA emulation               | Refused.                                                                                        |
| Raw CPU restore as Level 5 support | Refused.                                                                                        |
| Metadata-only success              | Refused.                                                                                        |

## Broad-support criteria

Broad Node support can move from `20%` to `25%` only if the new evidence covers real ecosystem variation, not just more copies of the same fixture. Acceptable rows include:

- installed package manager variants (`npm`, `pnpm`, and `yarn`) for the same selected app family;
- Node 20, 22, and 24 runtime rows with retained version/ABI evidence;
- CommonJS and ESM entry rows;
- Express and Fastify installed-app rows using the generic VM snapshot command;
- refusal rows for unsafe neighbors for each supported variation.

These rows still do not prove arbitrary Express, arbitrary Fastify, or arbitrary Node support.

## Claim-change gates

Before changing any claim constants or claim registry values:

1. Add product-path proof rows for the generic VM snapshot command.
2. Add a release-gated corpus report for both cross-architecture directions.
3. Add positive and negative rows to the support matrix.
4. Add drift guards for the new counts and row IDs.
5. Add a VM smoke that boots a Node workload, snapshots the VM with generic `--out`, restores the snapshot, and verifies behavior.
6. Keep release-gate summaries explicit about candidate evidence (`genericVmCorpus`) and retain `80 / 20 / 0` in all claim fields until the claim-change PR.
7. Run `machinen node-level5 85-readiness --generic-vm-corpus-report <file> --generic-vm-retained-evidence-report <file> --generic-vm-row-artifacts-report <file> --generic-vm-refusal-artifacts-report <file> --json`; it must show candidate evidence accepted and only the final `claim-change-unlocked` gate blocked before the claim PR.
8. Run format, lint, docs build, typecheck, Vitest, focused Node Level 5 smokes, full VM smoke, and `fallow audit --changed-since origin/main`.
9. Only then update claim values to `85 / 25 / 0`.

## Non-goals

- Do not claim arbitrary Node app support.
- Do not claim arbitrary Express or Fastify support.
- Do not use app-exported state, checkpoint hooks, selected-state descriptors, sidecar replay, source-ISA emulation, or metadata-only success.
- Do not implement runtime-profile snapshot/restore as the product path.
- Do not raise arbitrary process cross-architecture restore above `0%` in this milestone.
