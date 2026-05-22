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
argument0=0x600000000000
stateReportAddress=0x600000000000
timeoutSeconds=5
stackTargetStart=0x500000000000
stackSize=65536
stackPointer=0x500000010000
resource=close-fd fd=0 reason=missing-captured-fd
resource=inherit-stdio fd=1 stream=stdout closeOnExec=false
resource=reopen-file fd=7 path=/tmp/data.txt offset=9 access=0 closeOnExec=true
resource=synthetic-empty-pipe readFd=3 writeFd=4 closeOnExec=false
resource=synthetic-empty-eventfd fd=5 closeOnExec=false
resource=synthetic-timerfd fd=6 closeOnExec=false
memory=copy-captured-bytes mapping=heap targetStart=0x600000000000 sizeBytes=4096 permissions=rw-p sourceFile=/tmp/native-memory.bin sourceOffset=0
memory=recreate-guard mapping=stack-guard targetStart=0x600000001000 sizeBytes=4096 permissions=---p
```

Supported fd-table resources and memory materialization are intentionally narrow:

- `close-fd` for target fd slots that were not present in the captured table;
- `inherit-stdio` for explicitly allowed stdout/stderr inheritance;
- `reopen-file` for regular files that can be reopened by path with a modeled
  offset and access mode;
- `synthetic-empty-pipe` with a modeled read fd and optional write fd;
- `synthetic-empty-eventfd` with an empty non-semaphore eventfd;
- `synthetic-timerfd` with a disarmed/future one-shot timerfd;
- `copy-captured-bytes` for explicitly safe, non-executable writable mappings;
- `recreate-guard` for guard / `PROT_NONE` ranges.

The runtime fd-table planner emits these resource lines from translated native
resources. The in-guest loader validates duplicate fd ownership before launching
the trampoline, applies `close-fd` and `reopen-file` recipes in the child process,
and forwards synthetic fd recipes plus `--set-cloexec-fd` intents to the
trampoline. The trampoline applies close-on-exec flags after the
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

The existing target-VM synthetic proof now injects the loader and descriptor into
the amd64 guest and executes the loader instead of invoking the trampoline
directly. The descriptor may carry an optional `argument0` target register value
and an optional `stateReportAddress` for real target-native continuation
attempts. The state report address lets the trampoline read a small report that
the continuation writes after consuming restored memory and fd/resource state.
Completion is credited only when the descriptor gate succeeds and the
target-native continuation returns/exits in the guest with the expected modeled
result.
