# Native actual target resume execution

Issue #534 added the explicit target-native resume execution plan for the actual `/bin/sleep` proof. Issue #536 adds the first bounded execution attempt for that plan.

## Plan gate

The proof creates a resume execution plan only after these earlier gates have data:

- mapped target-native code location;
- target-native module bytes from the explicit amd64 target root;
- target unwind match;
- target frame-state materialization;
- synthetic target caller frame.

The plan records the target architecture, entry address, stack pointer, caller-frame id, target byte modules, and the intended executor (`native-resume-trampoline`). The planner itself still reports `attemptedResume: false`; it does not jump.

## Execution attempt

On Linux/amd64, the actual proof now runs a short-lived native helper. The helper maps the explicit target amd64 byte window at the planned target address, installs the synthetic target stack, transfers control to the target bytes, and records what happened.

The current `/bin/sleep` continuation is still not a completed migration. The attempt is expected to fault until more libc/kernel continuation state is modeled. A fault is still useful proof: it shows that control reached the target-native amd64 instruction stream without source text reuse, source-ISA emulation, or a Node/Bun sidecar.

The summary reports the attempt separately:

```json
{
  "targetResumeExecutionAttempt": {
    "status": "faulted",
    "targetArch": "amd64",
    "instructionPointerInTargetBytes": true,
    "attemptedResume": true
  },
  "attemptedResume": true,
  "migrationCompleted": false,
  "sourceTextReusedAsTargetCode": false,
  "sourceIsaEmulationUsed": false,
  "sidecarRuntimeUsed": false
}
```

`migrationCompleted: false` is intentional. This proves the first native execution transfer, not full transparent process migration.
