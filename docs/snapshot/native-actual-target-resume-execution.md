# Native actual target resume execution plan

Issue #534 adds an explicit target-native resume execution plan for the actual `/bin/sleep` proof.

## What is new

The proof now creates a resume execution plan only after these earlier gates have data:

- mapped target-native code location;
- target-native module bytes from the explicit amd64 target root;
- target unwind match;
- target frame-state materialization;
- synthetic target caller frame.

The plan records the target architecture, entry address, stack pointer, caller-frame id, target byte modules, and the intended executor (`native-resume-trampoline`).

## Boundary

This is still not a native jump. The plan mode is `planned-not-executed`, and the summary keeps:

```json
{
  "attemptedResume": false,
  "sourceTextReusedAsTargetCode": false,
  "sourceIsaEmulationUsed": false,
  "sidecarRuntimeUsed": false
}
```

With this plan present, the actual continuation planner can reach `ready`. That means all modeled planning gates have explicit data. It does not mean `/bin/sleep` has resumed on amd64 yet.
