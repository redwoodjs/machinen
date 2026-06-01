# Node Level 5 85 / 25 / 0 release checklist

Before publishing the 85 / 25 / 0 claim, run:

```sh
pnpm run format:check
pnpm run lint
pnpm run build:docs
pnpm run typecheck
NPM_CONFIG_USERCONFIG=/dev/null npx vitest run
bash scripts/smoke/node-level5-generic-vm-corpus.sh
bash scripts/smoke/node-level5-generic-vm-row-artifacts.sh
bash scripts/smoke/node-level5-generic-vm-refusal-artifacts.sh
bash scripts/smoke/node-level5-product-support-85-readiness.sh
bash scripts/smoke/node-level5-product-support-85-claim-ready.sh
MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 scripts/smoke/node-level5-vm-detected-product-snapshot.sh
MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests
pnpm exec fallow audit --changed-since origin/main
```

The release must keep arbitrary process cross-architecture restore at `0%`.
