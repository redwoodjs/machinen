# Level 4 pipe portable restore

Goal 016 adds pipes as the third portable restore adapter after ping and eventfd.

## Supported subset

`pipe-pair-v1-empty-no-waiters` is implemented product support for a narrow Level 4 kernel-resource reconstruction boundary:

- exactly one read end and one write end;
- distinct bounded source fd numbers;
- empty pipe buffer;
- peer lifetime known open;
- waiters known empty;
- read end readiness known not-readable;
- close-on-exec only;
- no active pipe read/write syscall;
- target-native verifier output required.

Unsafe neighbors refuse with stable `pipe-*` refusal codes and `migrationCompleted=false`. Buffered pipe bytes are intentionally refused for this first pipe product boundary.

## Usage

```sh
printf 'pipe readFd=10 writeFd=12 buffer=empty peer=open waiters=none readiness=not-readable flags=cloexec\n' > pipe.verify

machinen capture pipe \
  --out ./pipe.portable \
  --source-arch arm64 \
  --target-arch amd64 \
  --source-verifier-output ./pipe.verify \
  --read-fd 10 \
  --write-fd 12

machinen restore ./pipe.portable --target-arch amd64 --json
```

The restore adapter boots a target VM, writes `portable-pipe.json` into the guest, creates a target-native Linux pipe pair, verifies that the read end is not readable while the peer remains open, and keeps the target process alive. Detached restore writes a target summary and returns the restored VM name/pid.
