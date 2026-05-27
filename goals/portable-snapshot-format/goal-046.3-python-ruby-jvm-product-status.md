# Goal 46.3: Python/Ruby/JVM product support/refusal surfaces

## Objective

Classify every Python, Ruby, and JVM proof/refusal profile into the Goal 46
product registry and expose it through product discovery.

## Completion record

Completed by Goal 46's product claim registry:

- Python, Ruby, and JVM profiles are classified under `family=python-ruby-jvm`.
- Positive non-Node runtime proof profiles remain `proof-only-fixture` with
  `product-surface-not-implemented` until product descriptors are added.
- Native extension/JNI/gem/C-extension and runtime-boundary refusals remain
  `stable-product-refusal` with existing refusal codes and
  `migrationCompleted=false`.
- Discovery: `machinen support --family python-ruby-jvm --json`.
- Checked summary:
  `docs/snapshot/checked-summaries/product-claim-registry/python-ruby-jvm.json`.
