# Native actual target resume execution

Issue #534 added the explicit target-native resume execution plan for the actual `/bin/sleep` proof. Issue #536 added the first bounded execution attempt for that plan. Issue #539 classifies the first target-native fault. Issue #541 audits the target landing provenance before interpreting that fault.

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

The summary reports the attempt separately, records target landing provenance, and records a `target-resume-fault-state` blocker when the attempt faults. The current raw cross-ISA RVA landing maps into target libc, but objdump decoded from the covering target FDE shows the planned address falls between amd64 instruction boundaries:

```json
{
  "blockingBoundary": "target-resume-fault-state",
  "blockingRefusal": {
    "code": "target-resume-fault-invalid-code-landing"
  },
  "targetResumeLandingProvenance": [
    {
      "targetAddress": "0x7001000b6ca0",
      "targetRelativeAddress": "0xb6ca0",
      "targetModule": {
        "path": "/usr/lib/x86_64-linux-gnu/libc.so.6"
      },
      "section": { "name": ".text", "executable": true },
      "symbol": { "name": "wcstod_l@@GLIBC_2.3", "offset": "0x13e0" },
      "instructionBoundary": { "state": "known-invalid" }
    }
  ],
  "targetResumeExecutionAttempt": {
    "status": "faulted",
    "targetArch": "amd64",
    "targetInstructionBytes": "e7064883f03f...",
    "registers": {
      "rip": "0x7001000b6ca0",
      "rsp": "0x50000000fff8"
    },
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

`migrationCompleted: false` is intentional. This now proves the first native execution transfer and, more importantly, proves the current same-RVA landing is not a meaningful amd64 continuation. It is not full transparent process migration.
