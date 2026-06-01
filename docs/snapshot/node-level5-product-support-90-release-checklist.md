# Node Level 5 90 / 30 / 0 release checklist

Before publishing the 90 / 30 / 0 claim, run:

```sh
pnpm run format:check
pnpm run lint
pnpm run build:docs
pnpm run typecheck
NPM_CONFIG_USERCONFIG=/dev/null npx vitest run
bash scripts/smoke/node-level5-framework-introspection-corpus.sh
bash scripts/smoke/node-level5-framework-product-evidence.sh
bash scripts/smoke/node-level5-framework-capability-readiness.sh
bash scripts/smoke/node-level5-framework-capability-claim-ready.sh
bash scripts/smoke/node-level5-product-support-90-claim.sh
pnpm exec fallow audit --changed-since origin/main
git diff --check origin/main...HEAD
```

Run full VM smoke tests only when VM lifecycle, VMM, rootfs/base assets, CLI boot/exec/mount, snapshot/restore mechanics, virtio devices, memory/ballooning, FUSE/live mounts, or broad end-to-end behavior changed.

## Required evidence

The claim-ready report must verify:

- 18 framework graph artifacts;
- 16 restored behavior probes;
- 20 unsafe-state refusal artifacts;
- 54 retained framework artifacts total;
- arbitrary process cross-architecture restore remains 0;
- arbitrary Express, Fastify, and Node support remain unclaimed.
