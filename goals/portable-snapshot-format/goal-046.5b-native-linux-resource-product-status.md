# Goal 46.5b: Native Linux resource product support/refusal surfaces

## Objective

Classify native Linux resource proof/refusal profiles into the Goal 46 product
registry and expose them through product discovery.

## Completion record

Completed by Goal 46's product claim registry:

- Native Linux resource profiles are classified under
  `family=native-linux-resource`.
- Positive resource proofs remain `proof-only-fixture` with
  `product-surface-not-implemented` until product descriptors are added.
- Futex, eventfd, timerfd, memfd, namespaces, seccomp, landlock, cgroup, rlimit,
  prctl, PTY/termios, SysV IPC, signalfd, signal, and related unsafe neighbors
  remain `stable-product-refusal` with existing refusal codes and
  `migrationCompleted=false`.
- Discovery: `machinen support --family native-linux-resource --json`.
- Checked summary:
  `docs/snapshot/checked-summaries/product-claim-registry/native-linux-resource.json`.
