# Level 4 timerfd portable restore

Goal 017 adds timerfd as the fourth portable restore adapter after ping, eventfd, and pipes.

## Supported subset

`timerfd-relative-oneshot-v1-monotonic` is implemented product support for a narrow Level 4 kernel-resource reconstruction boundary:

- `CLOCK_MONOTONIC` timerfd;
- relative one-shot timer;
- bounded positive remaining time;
- no interval/periodic mode;
- no unread expirations;
- close-on-exec only;
- no active timerfd read syscall;
- target-native verifier output required.

Unsafe neighbors refuse with stable `timerfd-*` refusal codes and `migrationCompleted=false`. Absolute timers, cancel-on-set state, unsupported clocks, periodic intervals, and unread ticks are intentionally refused for this first timerfd product boundary.

## Usage

```sh
printf 'timerfd clock=monotonic mode=relative remainingMs=60000 intervalMs=0 expirations=0 flags=cloexec\n' > timerfd.verify

machinen capture timerfd \
  --out ./timerfd.portable \
  --source-arch arm64 \
  --target-arch amd64 \
  --source-verifier-output ./timerfd.verify \
  --remaining-ms 60000

machinen restore ./timerfd.portable --target-arch amd64 --json
```

The restore adapter boots a target VM, writes `portable-timerfd.json` into the guest, creates a target-native Linux timerfd, arms it as a relative one-shot timer, verifies the logged clock and remaining-time policy, and keeps the target process alive. Detached restore writes a target summary and returns the restored VM name/pid.
