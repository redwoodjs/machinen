# Native continuation classifier

This lane is the first arbitrary-PID classifier for native continuation research.
It classifies a live process by **CPU/memory/resource shape**, not by binary name.

Run against a live PID on Linux:

```sh
python3 portability/research/native-continuation-classifier/classify.py --pid <pid>
```

The result is JSON. Accepted rows include an architecture-neutral capture descriptor:

```json
{
  "decision": "accepted",
  "shapeId": "shape-controlled-pty-read-empty-queue",
  "reason": "single process blocked in pty read with no queued pty bytes",
  "descriptor": {
    "architectureNeutral": true,
    "cpu": { "wait": "pty-read", "sourceIsaEmulationRequired": false },
    "memory": { "rawHeapStackRegistersCaptured": false },
    "resources": { "pty": { "queueBytesKnownEmpty": true } },
    "materializer": { "strategy": "target-native-reexec-or-shape-adapter" }
  }
}
```

Refused rows must not include a descriptor.

The classifier inspects:

- `/proc/$pid/fd` for fd kinds and queue bytes where available
- `/proc/$pid/syscall` for active wait syscall
- `/proc/$pid/wchan` for kernel wait names
- `/proc/$pid/status` for thread count and `TracerPid`

Accepted first shapes:

- `shape-controlled-pty-read-empty-queue` — one live process, pty fd, blocked in
  a pty read-like wait, and no queued pty bytes.
- `shape-pipe-empty-blocked-endpoint` — pipe endpoint blocked with an empty pipe buffer.
- `shape-socket-listener-empty-accept-queue` — listener socket with no queued accepts/bytes.
- `shape-socket-connected-local-empty-queues` — loopback connected pair with empty queues,
  reconstructed by semantic reconnect, not kernel socket identity.
- `shape-threads-all-parked-known-waits` — all threads parked in known waits; thread stacks
  are not captured.

Refused first shapes:

- ptrace/inferior ownership present
- non-empty pty queue
- pipe with unread bytes
- socket queued/in-flight bytes
- active or unclassified live thread
- unclassified process shape

The verifier also retains stream-boundary descriptors/refusals:

- `curl`: accept before request and after complete response; refuse mid-body.
- `tar`: accept before first output block and after file boundary; refuse mid-file stream.
- `rsync`: accept before destination mutation and after file boundary; refuse mid-copy.
- `openssl enc`: accept before cipher init and after final block; refuse mid cipher stream.

`--paused-vm` marks observations as `paused-vm-atomic` so descriptors can distinguish
race-free VM/process observations from live procfs best-effort observations.

This does **not** claim arbitrary native process continuation. It is the front
door for arbitrary binaries: classify into a known safe shape or fail closed.

Run retained amd64+arm64 probes:

```sh
portability/research/native-continuation-classifier/verify.sh
```

Retained output: `retained/report.json`.
