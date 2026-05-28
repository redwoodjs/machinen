# Goal 46.1: Node.js product support/refusal surfaces

## Objective

Classify every Node.js cross-architecture proof/refusal profile into the Goal 46
product registry and expose it through product discovery.

## Completion record

Completed by Goal 46's product claim registry:

- Node.js profiles are classified under `family=nodejs`.
- Positive Node proof profiles remain `proof-only-fixture` with
  `product-surface-not-implemented` until a Node product descriptor is added.
- Node refusal profiles remain `stable-product-refusal` with their existing
  refusal codes and `migrationCompleted=false`.
- Discovery: `machinen support --family nodejs --json`.
- Checked summary:
  `docs/snapshot/checked-summaries/product-claim-registry/nodejs.json`.
