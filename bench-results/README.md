# Benchmark results

Raw benchmark captures do not belong in this repository. They are noisy, can be large, and make git history harder to review.

Store durable benchmark runs as GitHub Release assets in:

https://github.com/redwoodjs/machinen-benchmarks/releases

## Storage policy

Use exactly two benchmark release kinds in `redwoodjs/machinen-benchmarks`:

1. `commit-run`
   - A benchmark for one exact source commit.
   - Use for PRs, experiments, and regressions.
   - Tag shape: `run-YYYY-MM-DD-<host-os>-<host-arch>-<guest-arch>-<accelerator>-<commit>-<topic>`.

2. `release-baseline`
   - The official benchmark baseline for a Machinen release.
   - Use for release-to-release comparisons.
   - Tag shape: `baseline-v<version>-<host-os>-<host-arch>-<guest-arch>-<accelerator>`.

Do not use separate `comparison` or `ci-run` kinds. If one commit-run contains variants, record the variants in `metadata.json` and in the asset filenames.

## Raw asset filename format

Use this shape for raw JSON assets:

```text
bench-<suite>-<host-os>-<host-arch>-<guest-arch>-<accelerator>-n<N>-<commit-or-release>.json.gz
```

If the run has an important variant, add it before `n<N>`:

```text
bench-<suite>-<host-os>-<host-arch>-<guest-arch>-<accelerator>-<variant>-n<N>-<commit-or-release>.json.gz
```

Examples:

```text
bench-core-linux-x64-amd64-kvm-n3-f6e5506c.json.gz
bench-all-linux-x64-amd64-kvm-disk-n5-8ca1327c.json.gz
bench-all-linux-x64-amd64-kvm-ramdisk-n5-8ca1327c.json.gz
bench-all-darwin-arm64-arm64-hvf-n5-v0.7.0.json.gz
```

Each release must include:

- `metadata.json`
- `summary.md`
- one or more gzipped raw JSON assets

`metadata.json` must record the source repo, source commit or release, source branch, dirty state, host OS, host arch, guest arch, accelerator, command, suite, sample count, host details, and artifact names.

For PRs, post a short summary table and link to the per-commit benchmark release. Do not commit raw benchmark JSON to this repository.
