# Machinen Session protocol v2

A session worker listens on a same-user Unix stream socket:

```text
/tmp/machinen-session-<uid>/<session-id>.sock
```

The directory has mode `0700` and each socket has mode `0600`. Session IDs are
limited to 64 ASCII letters, digits, dots, underscores, and hyphens. The SQLite
session record stores the worker protocol version, allowing a new client binary
to keep attaching to a live v1 worker after an upgrade.

## Framing

Every frame starts with a five-byte header:

```text
byte 0      frame kind
bytes 1–4   unsigned payload length, big-endian
bytes 5…    payload
```

Payloads are limited to 32 KiB. Terminal data is opaque bytes, not text.

## Attach handshake

A v2 connection starts with an `A` frame from the client:

```text
bytes 0–3    protocol version (`2`), big-endian u32
byte 4       requested flags: writer=1, resize=2, control=4
byte 5       recovery mode: journal=0, latest-screen=1
bytes 6–7    reserved, zero
bytes 8–15   last sequence already applied by the client, big-endian u64
bytes 16–23  client identifier, big-endian u64
```

Interactive clients normally request writer and resize leases. Read-only
clients request neither. Same-user one-shot commands such as `send` and `signal`
use the control flag and do not take an interactive lease.

The worker protocol version in SQLite is `1` for sessions migrated from the
original implementation. The current attach client omits the handshake for
those workers and continues understanding their unsequenced `O` history frames.
A running PTY is therefore not replaced merely to upgrade its helper binary.

## Client to worker

| Kind | Name            | Payload                                      |
| ---- | --------------- | -------------------------------------------- |
| `A`  | Attach request  | Version, flags, resume sequence, client ID   |
| `I`  | Input           | Bytes to write to the PTY                    |
| `R`  | Resize          | Big-endian `u16 columns`, `u16 rows`         |
| `S`  | Signal          | Big-endian signed 32-bit POSIX signal number |
| `P`  | Heartbeat       | Empty; renews held leases                    |
| `T`  | Telemetry query | Empty; requests current foreground metadata  |

## Worker to client

| Kind | Name             | Payload                                             |
| ---- | ---------------- | --------------------------------------------------- |
| `Q`  | Sequenced output | Big-endian `u64 sequence`, followed by PTY bytes    |
| `C`  | VT checkpoint    | Sequence, format, chunk flags, reconstruction bytes |
| `H`  | History complete | Big-endian `u64` current sequence                   |
| `L`  | Lease status     | Granted flags, requested flags                      |
| `X`  | Exit             | Big-endian signed 32-bit exit status                |
| `E`  | Failure          | UTF-8 diagnostic for display                        |
| `O`  | Legacy output    | Unsequenced bytes from a v1 worker                  |
| `T`  | Telemetry        | Activity, shell PID, foreground PID, and names      |

A `Q` event can use multiple frames when its original SQLite payload plus the
sequence header would exceed 32 KiB. Each chunk repeats the event sequence.

## Foreground telemetry

A same-user control client can send an empty `T` frame. A current worker replies
with one `T` payload:

```text
byte 0       activity: unknown=0, idle=1, working=2
bytes 1–3    reserved, zero
bytes 4–7    login-shell PID, big-endian signed i32
bytes 8–11   foreground process-group leader PID, big-endian signed i32
byte 12      shell-name byte length
byte 13      foreground-command byte length
bytes 14…    UTF-8 shell name, then UTF-8 foreground command
```

The worker derives the foreground group from the PTY it owns. A foreground
shell is `idle`; a different foreground process is `working`. Process names are
best-effort host metadata. `machinen-session inspect` returns `unknown` for old
live workers that predate this frame instead of restarting them or guessing
from a Desktop-side process list.

## Resume and checkpoints

Output and resize events share one monotonically increasing sequence. An attach
request names the last sequence whose effects the client has already applied.

- If that sequence is still inside retained history, the worker sends only
  newer `Q` output.
- If compaction has passed it, the worker first sends the latest `C` checkpoint,
  then output after the checkpoint.
- A fresh journal client requests sequence zero.
- A latest-screen client receives a fresh checkpoint generated from the live
  worker's in-memory VT state at its current sequence. It skips retained journal
  output, making the visible screen available immediately without rebuilding
  scrollback.
- `H` marks the transition from recovery to the live stream and reports the
  worker's current sequence.

Checkpoint format version 1 is a renderer-neutral VT reconstruction stream. It
contains a terminal reset, cursor-addressed visible UTF-8 cells, and final cursor
position. `C` payload bytes are:

```text
bytes 0–7    checkpoint sequence, big-endian u64
bytes 8–11   checkpoint format version, big-endian u32
byte 12      chunk flags: first=1, last=2
bytes 13…    VT reconstruction bytes
```

The v1 checkpoint intentionally captures visible text and cursor state, not
renderer-owned selection, viewport, title, or styling. Those can be added by a
new checkpoint format without changing session identity or event sequencing.

The worker generates a checkpoint after 256 KiB of PTY output by default
(configurable with `--checkpoint-bytes`, 32 KiB–16 MiB). Saving the replacement
checkpoint and deleting covered events is one SQLite transaction. Only the
latest checkpoint and output after it remain, so recovery storage is bounded by
the checkpoint screen plus the configured journal window.

## Writer and resize leases

Writer and resize ownership are independent. The first eligible interactive
client receives each requested lease. A lease lasts 30 seconds and attach
clients send a heartbeat every 10 seconds. Input or resize activity also renews
ownership. Disconnecting releases ownership immediately; an attached waiter is
then granted the lease.

A client without the relevant lease remains a watcher and receives an `E`
diagnostic if it attempts the operation. Same-user control connections are an
explicit administrative path used by `send`, `signal`, and `stop`.

## Disconnect and recovery boundary

A disconnect closes only that attachment. The worker continues draining and
journaling the PTY. Focus, smooth scrolling, selection, and visual viewport are
client-owned and never appear in this protocol.

After reboot or worker loss, `reconcile` marks a formerly live record as
`orphaned` when its private socket is no longer reachable. Checkpoint and output
history remain attachable, but Machinen does not claim to recreate the lost PTY
or process. Restart is an explicit new-process action.
