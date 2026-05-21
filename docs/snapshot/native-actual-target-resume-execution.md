# Native actual target resume execution

Issue #534 added the explicit target-native resume execution plan for the actual `/bin/sleep` proof. Issue #536 added the first bounded execution attempt for that plan. Issue #539 classifies the first target-native fault. Issue #541 audits the target landing provenance before interpreting that fault. Issue #543 replaces raw same-RVA sleep landings with a semantic amd64 sleep continuation.

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

The summary reports the attempt separately, records target landing provenance, and records a `target-resume-fault-state` blocker when the attempt faults. For deferred sleep/timer syscalls, the planned entry now comes from the target libc sleep symbol instead of the source RVA:

```json
{
  "blockingBoundary": "target-resume-fault-state",
  "blockingRefusal": {
    "code": "target-resume-fault-unmodeled-memory"
  },
  "semanticTargetContinuations": [
    {
      "strategy": "semantic-sleep-timer-symbol",
      "symbolName": "clock_nanosleep@@GLIBC_2.17",
      "targetRelativeAddress": "0xcf4e0",
      "targetAddress": "0x7001000cf4e0"
    }
  ],
  "targetResumeLandingProvenance": [
    {
      "sourceRva": "0xb6ca0",
      "targetRva": "0xcf4e0",
      "continuationStrategy": "semantic-sleep-timer-symbol",
      "targetModule": {
        "path": "/usr/lib/x86_64-linux-gnu/libc.so.6"
      },
      "symbol": { "name": "clock_nanosleep@GLIBC_2.2.5", "offset": "0x0" },
      "instructionBoundary": { "state": "known-valid" }
    }
  ],
  "targetResumeExecutionAttempt": {
    "status": "faulted",
    "targetArch": "amd64",
    "targetInstructionBytes": "803ddec0100000...",
    "faultAddress": "0x7001001db5d8",
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

`migrationCompleted: false` is intentional. This now proves the first native execution transfer reaches a semantic amd64 sleep continuation. The current blocker is target process memory/libc state that is not modeled yet, not an invalid same-RVA code landing. It is not full transparent process migration.
