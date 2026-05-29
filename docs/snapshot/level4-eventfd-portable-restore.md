# Level 4 eventfd portable restore

Goal 015 adds eventfd as the second portable restore adapter after ping.

## Supported subset

`eventfd-counter-v1-nonsemaphore-no-waiters` is implemented product support for a narrow Level 4 kernel-resource reconstruction boundary:

- bounded nonzero eventfd counter (currently <= `UINT32_MAX` for target helper portability);
- semaphore mode disabled;
- waiters known empty;
- no aliases or duplicate descriptors;
- close-on-exec only;
- no active eventfd read/write syscall;
- target-native verifier output required.

Unsafe neighbors refuse with stable `eventfd-*` refusal codes and `migrationCompleted=false`.

## Usage

```sh
printf 'eventfd counter=42 semaphore=0 waiters=none aliases=none readiness=readable flags=cloexec\n' > eventfd.verify

machinen capture eventfd \
  --out ./eventfd.portable \
  --source-arch arm64 \
  --target-arch amd64 \
  --source-verifier-output ./eventfd.verify \
  --counter 42

machinen restore ./eventfd.portable --target-arch amd64 --json
```

The restore adapter boots a target VM, writes `portable-eventfd.json` into the guest, creates a target-native Linux eventfd, reads the counter once to verify readiness, writes the value back, and keeps the target process alive. Detached restore writes a target summary and returns the restored VM name/pid.
