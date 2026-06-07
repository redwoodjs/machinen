# Validation profiling and proof-container caches

Issue #559 adds a small profiler for the slow validation loop.

## Local timing reports

Run:

```sh
pnpm validation:profile --profile quick
```

Reports are written under `.validation-runs/`:

- timestamped JSON for machine-readable history
- timestamped Markdown for human review
- `.validation-runs/latest.md` for the most recent run

Profiles:

- `quick` — format, lint, docs, typecheck, Vitest, and fallow
- `required` — `quick` plus smoke tests
- `full` — `required` plus Agent CI

You can also time a custom set:

```sh
pnpm validation:profile --step format:check --step vitest --step smoke-tests
```

For a safe no-op report while testing the profiler:

```sh
pnpm validation:profile --dry-run --step format:check --step lint
```

When Agent CI timelines exist locally, the report also summarizes recent job
and slowest-task durations from:

```text
~/Library/Application Support/agent-ci/logs
```

## Proof-container install cache

Remote arm64/amd64 proof commands often start fresh Docker containers. Avoid
throwing away dependency setup by mounting persistent Corepack and pnpm caches
and using the helper:

```sh
docker run --rm \
  -v /tmp/machinen-corepack:/corepack \
  -v /tmp/machinen-pnpm-store:/pnpm-store \
  -e COREPACK_HOME=/corepack \
  -e MACHINEN_PNPM_STORE_DIR=/pnpm-store \
  -v "$PWD":/work \
  -w /work \
  node:22-bookworm \
  bash -lc 'bash scripts/proof-container-install.sh && pnpm exec tsx scripts/native-actual-real-utility-continuation.ts verify --json'
```

The helper runs `corepack enable`, points pnpm at the mounted store, performs a
`pnpm fetch --frozen-lockfile`, and then installs with `--prefer-offline`.
After the first warm run, repeated proof containers should spend much less time
installing the same packages.

## Use in the migration loop

The profiler does not replace the required checks. It records where time goes so
we can compare changes and optimize the largest buckets first. Keep the full
required validation before reporting work as done, but use `quick` or selected
steps while iterating.
