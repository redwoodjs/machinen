# Target guest restore loader

Issue #587 adds the first in-guest loader for portable machine snapshots. The
loader is a small amd64 guest program, not a success sidecar. It validates a
line-oriented restore descriptor, refuses unsupported state before target code is
entered, and then runs the native resume trampoline with the validated modeled
resources and continuation bytes.

Descriptor shape:

```text
kind=machinen.target-guest-restore
targetArch=amd64
codeFile=/tmp/machinen-target-bytes.bin
fileOffset=0
codeSize=16
targetAddress=0x700300000000
stateReportAddress=0x600000000000
translatedReturnAddress=0x700300000080
resumeMode=translated-frame
resumeRflags=0x8d7
resumeRegisterRax=0x2121212121212121
resumeRegisterRdi=0x7171717171717171
resumeRegisterRsi=0x6161616161616161
resumeRegisterRdx=0x6262626262626262
resumeRegisterRcx=0x6363636363636363
resumeRegisterR8=0x8888888888888888
resumeRegisterR9=0x9999999999999999
resumeRegisterR10=0x1010101010101010
resumeRegisterR11=0x1111111111111111
timeoutSeconds=5
stackTargetStart=0x500000000000
stackSize=65536
stackPointer=0x500000010000
frame=single-target-caller-frame framePointer=0x50000000ff80 canonicalFrameAddress=0x50000000fff0 returnAddressSlot=0x50000000fff0 returnAddress=0x700300000080 unwindId=target:realspin-final-jump calleeSavedRbx=0x1111111122222222 calleeSavedR12=0x1234567890abcdef calleeSavedR13=0x1313131313131313 calleeSavedR14=0x1414141414141414 calleeSavedR15=0x1515151515151515 slot0Offset=0 slot0Value=0x4652414d45504153 slot0Class=non-pointer-data slot1Offset=8 slot1Value=0x535441434b534c54 slot1Class=non-pointer-data
resource=close-fd fd=0 reason=missing-captured-fd
resource=inherit-stdio fd=1 stream=stdout closeOnExec=false
resource=reopen-file fd=7 path=/tmp/data.txt offset=9 access=0 closeOnExec=true
resource=synthetic-empty-pipe readFd=3 writeFd=4 closeOnExec=false
resource=synthetic-empty-eventfd fd=5 closeOnExec=false
resource=synthetic-eventfd fd=10 initialValue=0x2a closeOnExec=false
resource=synthetic-timerfd fd=6 clockId=1 settimeFlags=0 valueSeconds=0 valueNanoseconds=0 intervalSeconds=0 intervalNanoseconds=0 closeOnExec=false
resource=synthetic-signalfd fd=9 signalMask=0x200 flags=2048 closeOnExec=false
resource=synthetic-epoll fd=8 watchCount=1 watch0Fd=5 watch0Events=1 watch0Data=0x45504f4c4c closeOnExec=false
memory=copy-captured-bytes mapping=heap targetStart=0x600000000000 sizeBytes=4096 permissions=rw-p sourceFile=/tmp/native-memory.bin sourceOffset=0
memory=recreate-guard mapping=stack-guard targetStart=0x600000001000 sizeBytes=4096 permissions=---p
native=process-context action=chdir cwdHex=2f cwdSha256=8a5edab282632443219e051e4ade2d1d5bbc671c781051bf1437897cbdfea0f1
```

Supported fd-table resources and memory materialization are intentionally narrow:

- `close-fd` for target fd slots that were not present in the captured table;
- `inherit-stdio` for explicitly allowed stdout/stderr inheritance;
- `reopen-file` for regular files that can be reopened by path with a modeled
  offset and access mode;
- `synthetic-empty-pipe` with a modeled read fd and optional write fd, including
  the Goal 4 `pipe-pair-v1` empty-buffer/open-peer descriptor subset;
- `synthetic-empty-eventfd` with an empty non-semaphore eventfd;
- `synthetic-eventfd` with a Goal 4 `eventfd-counter-v1` non-semaphore counter
  value, refused unless the counter, waiter state, flags, and close-on-exec
  provenance are exact;
- `synthetic-timerfd` with a Goal 4 `timerfd-descriptor-v1` disarmed or
  relative future one-shot `CLOCK_MONOTONIC` timerfd, refused unless the clock,
  settime flags, remaining time, interval, unread-expiration state, fd flags,
  and close-on-exec provenance are exact;
- `synthetic-epoll` for the Goal 3 `interest-list-v1` subset: a finite
  level-triggered watch list over fds that already have target recipes;
- `synthetic-signalfd` for the Goal 3 `empty-queue-v1` subset: a normalized
  signal mask and supported flags, with no pending queue, queued `siginfo`,
  active signal frame, or active alt-stack state;
- `copy-captured-bytes` for explicitly safe, non-executable writable mappings;
- `recreate-guard` for guard / `PROT_NONE` ranges;
- `frame=single-target-caller-frame` for the current modeled translated caller
  frame: one return slot, the amd64 callee-saved register bank (`rbx`, `r12`,
  `r13`, `r14`, `r15`), a bounded dense vector of non-pointer data stack
  slots, and a target unwind identity;
- `native=process-context` for bounded argv/env/cwd/auxv handoff steps. The
  trampoline can apply and verify controlled env/cwd state before the target
  jump, while argv/auxv remain hashed handoff metadata until initial-stack/libc
  modeling is explicit.

The runtime fd-table planner emits these resource lines from translated native
resources. The in-guest loader validates duplicate fd ownership before launching
the trampoline, applies `close-fd` and `reopen-file` recipes in the child process,
and forwards synthetic fd recipes plus `--set-cloexec-fd` intents to the
trampoline. Pipe pair recipes are installed with target-owned `pipe2()` fds and
verified as open plus not readable before target-native completion. Eventfd counter recipes are installed with a target-owned `eventfd()`
followed by an exact 8-byte write of the modeled counter before the target-native
jump. Timerfd descriptor recipes are installed with target-owned
`timerfd_create()` and, when armed, `timerfd_settime()` using the modeled
relative one-shot `itimerspec`; disarmed descriptors are verified with a zero
`timerfd_gettime()` result. signalfd recipes are installed with `signalfd()` from
the normalized mask and flags. Epoll recipes are installed after their watched
synthetic fds, signalfds, and reopened files exist, then `epoll_ctl(EPOLL_CTL_ADD)` recreates
the declared interest list. The trampoline applies close-on-exec flags after the
loader-to-trampoline `exec` boundary and before the target-native jump, so modeled
fds remain open for restore setup but have the captured descriptor flag by the
restored execution point.

Executable source mappings are not copied as target code. They must be replaced
by generated target-native bytes or a proven target-module materialization path.
Everything else fails closed with a precise refusal, currently:

- `target-guest-loader-descriptor-invalid`
- `target-guest-loader-target-arch-unsupported`
- `target-guest-loader-resource-unsupported`
- `target-guest-loader-invalid-fd`
- `target-guest-loader-invalid-continuation`
- `target-guest-loader-memory-unsupported`
- `target-guest-loader-frame-unsupported`

The existing target-VM synthetic proof now injects the loader and descriptor into
the amd64 guest and executes the loader instead of invoking the trampoline
directly. The descriptor may carry an optional legacy `argument0` target register
value for simple single-argument attempts, an optional `stateReportAddress`, an
optional `translatedReturnAddress`, an optional `resumeMode=translated-frame`,
optional modeled `resumeRflags` condition-code state, optional modeled
resume-register values, and an optional translated caller frame for real
target-native continuation attempts. `argument0` is rejected when a
resume-register bank is present so `%rdi` can be restored natively instead of
being reserved for the proof ABI.
The state report address lets the trampoline read a small report that the
continuation writes after consuming restored memory and fd/resource state. The
translated return address lets the trampoline seed a modeled target return slot
before the host return slot, so the continuation can return through
target-native landing code before control comes back to the trampoline. The
translated frame lets the trampoline materialize a small target stack frame,
seed `rbp` plus the modeled callee-saved register bank, and require the target
code to validate that modeled frame/register/slot state. The resume-register
handoff seeds caller-scratch registers (`rax`, `rdi`, `rsi`, `rdx`, `rcx`, `r8`,
`r9`, `r10`, `r11`) immediately before the target-native jump and requires the
target code to report the values it observed before clobbering them. The proof
report address is carried out-of-band as `stateReportAddress`, so no target entry
GPR is reserved by the reporting ABI. The `resumeRflags` handoff seeds only the
supported user-mode condition-code bits (`CF`, `PF`, `AF`, `ZF`, `SF`, `OF`, plus
reserved bit 1); privileged/process-control bits such as `IF`, `DF`, `TF`, IOPL,
and system flags are refused instead of replayed ambiguously. Translated resume
mode additionally requires the target code to write a resume-path marker after
observing the modeled frame/stack state. Completion is credited only when the
descriptor gate succeeds and the target-native
continuation returns/exits in the guest with the expected modeled result.
