# Level 4 TCP listener portable restore

Goal 018 adds TCP listener-only sockets as the fifth portable restore adapter after ping, eventfd, pipes, and timerfd.

## Supported subset

`tcp-listener-v1-loopback-empty-accept-queue` is implemented product support for a narrow Level 4 kernel-resource reconstruction boundary:

- IPv4 loopback bind: `127.0.0.1`;
- static non-zero TCP port;
- explicit backlog, currently `1..128`;
- `SO_REUSEADDR` enabled;
- empty accept queue;
- no active TCP connections;
- no partial send/receive state;
- no active socket syscall;
- target-native verifier output required.

This is listener-only reconstruction. Active TCP streams and queued accepted connections remain outside this product boundary and fail closed with stable `tcp-listener-*` refusal codes.

## Usage

```sh
printf 'tcp-listener family=inet protocol=tcp bind=127.0.0.1:18080 backlog=16 acceptQueue=empty reuseaddr=true\n' > tcp.verify

machinen capture tcp-listener \
  --out ./tcp.portable \
  --source-arch arm64 \
  --target-arch amd64 \
  --source-verifier-output ./tcp.verify \
  --bind-address 127.0.0.1 \
  --port 18080 \
  --backlog 16

machinen restore ./tcp.portable --target-arch amd64 --json
```

The restore adapter boots a target VM, writes `portable-tcp-listener.json` into the guest, creates a target-native Linux TCP socket, applies `SO_REUSEADDR`, binds/listens on the recorded loopback port, verifies the logged bind/backlog/options line, and keeps the target listener process alive.
