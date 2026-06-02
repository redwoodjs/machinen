# Selected native support matrix

This is the claim-bearing matrix for the selected native workload scope:

- subset: `selected-single-thread-native-workload-v1`
- product command path: `machinen capture native` + `machinen restore`
- public claim allowed by this matrix: `100 / 100 / 0`
- arbitrary Linux process restore: still `0`

The matrix is intentionally tiny. It covers one supported selected workload row in both directions and retained product refusals for neighboring unsupported states:

1. active syscall source state;
2. unsupported source resource state;
3. target verifier shortcut/source-ISA-emulation attempt.

It does not claim arbitrary native processes, live thread sets, arbitrary kernel resources, raw CPU restore, or source ISA emulation.

Run:

```sh
bash scripts/smoke/selected-native-support-matrix.sh
```

Retained report:

- `retained/selected-native-support-matrix-report.json`
