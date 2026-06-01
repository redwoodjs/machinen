# Node Level 5 100 / 100 / 0 release checklist

Before publishing the 100 / 100 / 0 claim, run:

```sh
pnpm run format:check
pnpm run lint
pnpm run build:docs
pnpm run typecheck
NPM_CONFIG_USERCONFIG=/dev/null npx vitest run
bash scripts/smoke/node-level5-product-support-100-claim.sh
pnpm exec fallow audit --changed-since origin/main
git diff --check origin/main...HEAD
```

Run full VM smoke tests when product snapshot metadata or VM-facing behavior changes.

## Required evidence

The Node service claim ladder must verify all intermediate targets from 95 / 40 / 0 through 100 / 100 / 0, while keeping arbitrary process cross-architecture restore at 0.
