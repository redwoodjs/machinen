# Goal 46.5: Foundation/native descriptor and portable-machine product status

## Objective

Classify early portable snapshot, native process, descriptor, target-loader, and
portable-machine proof/refusal profiles into the Goal 46 product registry and
expose them through product discovery.

## Completion record

Completed by Goal 46's product claim registry:

- Foundation/native profiles are classified under `family=foundation-native`.
- Positive foundation proofs remain `proof-only-fixture` with
  `product-surface-not-implemented` until product descriptors are added.
- Descriptor, target-loader, native continuation, mapping, signal, stack, memory,
  executable, and process-context refusals remain `stable-product-refusal` with
  existing refusal codes and `migrationCompleted=false`.
- Discovery: `machinen support --family foundation-native --json`.
- Checked summary:
  `docs/snapshot/checked-summaries/product-claim-registry/foundation-native.json`.
