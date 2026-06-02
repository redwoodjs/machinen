# Selected native workload E2E harness proof

Status: `verified-e2e-harness`

This retained proof runs a tiny selected native workload on target-native Linux
runners in both directions:

- `arm64 -> amd64` executes on an amd64 Linux runner
- `amd64 -> arm64` executes on an arm64 Linux runner

The workload composes the already-retained substrate/resource proof rows into
actual target-native post-restore behavior. The target-native function runs on a
materialized stack with a guard page, consumes a materialized private memory
page, checks target-visible env/cwd bootstrap state, and verifies selected
resources:

- closed fd boundary
- inherited stdio
- reopened regular file fd with offset/read/write behavior
- buffered pipe
- eventfd counter
- one-shot timerfd readiness
- epoll interest list
- loopback TCP listener

This is a **harness proof**, not product support. It does not run `machinen
capture native` / `machinen restore`, and it does not raise arbitrary Linux
process restore above `0`.

Run:

```sh
bash scripts/smoke/native-selected-workload-e2e.sh
```

Retained report:

- `proofs/native-process-substrate/selected-workload-e2e/retained/native-selected-workload-e2e-report.json`
