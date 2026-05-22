# Native actual target resume execution

Issue #534 added the explicit target-native resume execution plan for the actual `/bin/sleep` proof. Issue #536 added the first bounded execution attempt for that plan. Issue #539 classifies the first target-native fault. Issue #541 audits the target landing provenance before interpreting that fault. Issue #543 replaces raw same-RVA sleep landings with a semantic amd64 sleep continuation. Issue #547 adds a synthesized amd64 sleep syscall continuation so the proof can avoid real target libc internals for the narrow sleep path.

## Plan gate

The proof creates a resume execution plan only after these earlier gates have data:

- mapped target-native code location;
- target-native module bytes, either from the explicit amd64 target root or from
  generated synthetic sleep syscall bytes;
- target unwind match when landing in a real target module;
- target frame-state materialization;
- synthetic target caller frame.

The plan records the target architecture, entry address, stack pointer, caller-frame id, target byte modules, and the intended executor (`native-resume-trampoline`). The planner itself still reports `attemptedResume: false`; it does not jump.

## Execution attempt

On Linux/amd64, the actual proof now runs a short-lived native helper. The helper maps the explicit target amd64 byte window at the planned target address, installs the synthetic target stack, transfers control to the target bytes, and records what happened.

For the narrow modeled `/bin/sleep` path, the synthesized target-native
`clock_nanosleep` continuation now exits the target process with status `0` after
the sleep syscall returns successfully. That exit is useful proof: it shows that
control reached and executed target-native amd64 bytes without source text reuse,
source-ISA emulation, or a Node/Bun sidecar.

The summary reports the attempt separately and records synthetic target landing
provenance. For deferred sleep/timer syscalls, the planned entry now comes from a
synthetic amd64 syscall continuation instead of the source RVA or target libc:

```json
{
  "syntheticSleepContinuations": [
    {
      "strategy": "synthetic-sleep-syscall",
      "targetAddress": "0x700200000000",
      "syscall": { "name": "clock_nanosleep", "number": 230 },
      "remainingTime": { "state": "modeled", "seconds": "30" }
    }
  ],
  "targetResumeExecutionAttempt": {
    "status": "exited",
    "targetArch": "amd64",
    "exitStatus": 0,
    "instructionPointerInTargetBytes": true,
    "attemptedResume": true
  },
  "attemptedResume": true,
  "migrationCompleted": true,
  "sourceTextReusedAsTargetCode": false,
  "sourceIsaEmulationUsed": false,
  "sidecarRuntimeUsed": false
}
```

`migrationCompleted: true` is intentionally narrow here. It applies to this
modeled `/bin/sleep` path only, after the generated amd64 sleep syscall bytes
exit the target process with status `0`. Other planned, faulted, timed-out, trampoline-return-only, or interrupted
synthetic syscall attempts still keep `migrationCompleted: false`. Descriptor
failure exits are classified as `target-synthetic-signal-restart-unsupported` or
`target-synthetic-syscall-return-unmodeled`, depending on the shared synthetic
completion policy. Legacy descriptor-less sleep failure exits still map to
`target-sleep-signal-restart-unsupported`. Synthetic sleep summaries also carry
generated-byte, syscall-argument, stack/register, and no-source-reuse provenance
so the completed proof is auditable without trusting libc internals.
