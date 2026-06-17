# Benchmark results

Raw benchmark captures do not belong in this repository. They are noisy, can be large, and make git history harder to review.

Store durable benchmark runs as GitHub Release assets in:

https://github.com/redwoodjs/machinen-benchmarks/releases

## Storage policy

Use two kinds of releases in `redwoodjs/machinen-benchmarks`:

1. Per source commit/run releases for PRs, experiments, and regressions.
   - Tag shape: `run-YYYY-MM-DD-<commit>-<short-topic>`
   - Include `metadata.json`, `summary.md`, and gzipped raw JSON assets.
   - `metadata.json` must record the source repo, source commit, source branch, dirty state, command, host, and benchmark config.

2. Curated product release baselines for official release comparisons.
   - Tag shape: `machinen-v<version>-baseline`
   - Include the official benchmark set for that released version.

For PRs, post a short summary table and link to the per-commit benchmark release. Do not commit raw benchmark JSON to this repository.
