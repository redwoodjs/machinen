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
timeoutSeconds=5
stackTargetStart=0x500000000000
stackSize=65536
stackPointer=0x500000010000
resource=synthetic-empty-pipe readFd=3 writeFd=4
resource=synthetic-empty-eventfd fd=5
```

Supported resources are intentionally narrow:

- `synthetic-empty-pipe` with a modeled read fd and optional write fd;
- `synthetic-empty-eventfd` with an empty non-semaphore eventfd.

Everything else fails closed with a precise refusal, currently:

- `target-guest-loader-descriptor-invalid`
- `target-guest-loader-target-arch-unsupported`
- `target-guest-loader-resource-unsupported`
- `target-guest-loader-invalid-fd`
- `target-guest-loader-invalid-continuation`

The existing target-VM synthetic proof now injects the loader and descriptor into
the amd64 guest and executes the loader instead of invoking the trampoline
directly. Completion is still credited only to generated target-native amd64
continuation bytes returning/exiting in the guest.
