# Machinen Session protocol v2

A session worker listens on a same-user Unix stream socket:

```text
/tmp/machinen-session-<uid>/<session-id>.sock
```

The directory has mode `0700` and each socket has mode `0600`. Session IDs are
limited to 64 ASCII letters, digits, dots, underscores, and hyphens. The SQLite
session record stores the worker protocol version, allowing a new client binary
to keep attaching to a live v1 worker after an upgrade.

Workspace records and `sessions.workspace_id` live in the shared SQLite control
plane, not in this per-worker socket protocol. `machinen-session workspace` and
`list` expose that durable registry, so changing workspace metadata never
restarts or renegotiates a live PTY worker.

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
clients request neither. Same-user one-shot commands such as `send`, `signal`,
presence queries, and control transfer use the control flag and do not take an
interactive lease. The client identifier names an attachment for presence and
explicit control transfer; values are limited to the nonzero JSON-safe integer
range so list output can round-trip through JavaScript clients. Current attach
clients follow the handshake with an `N` frame containing their display name
and PID.

Current workers advertise optional protocol-v2 extensions through a `B` query.
Older live v2 workers close only that short-lived capability connection, so a
new helper can continue attaching without replacing their PTY. Short-lived
control connections bound socket reads and writes to one second, preventing an
unresponsive live worker from blocking discovery or creation of other sessions.

The worker protocol version in SQLite is `1` for sessions migrated from the
original implementation. The current attach client omits the handshake for
those workers and continues understanding their unsequenced `O` history frames.
A running PTY is therefore not replaced merely to upgrade its helper binary.

## Client to worker

| Kind | Name            | Payload                                                    |
| ---- | --------------- | ---------------------------------------------------------- |
| `A`  | Attach request  | Version, flags, resume sequence, client ID                 |
| `I`  | Input           | Bytes to write to the PTY                                  |
| `R`  | Resize          | Big-endian `u16 columns`, `u16 rows`                       |
| `S`  | Signal          | Big-endian signed 32-bit POSIX signal number               |
| `P`  | Heartbeat       | Empty; renews held leases                                  |
| `T`  | Telemetry query | Empty; requests current foreground metadata                |
| `B`  | Capabilities    | Empty; requests supported protocol-v2 extension bits       |
| `N`  | Client info     | PID, display-name length, and UTF-8 display name           |
| `V`  | Client list     | Empty; requests the currently attached interactive clients |
| `K`  | Take control    | Big-endian `u64` identifier of the target attachment       |

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
| `B`  | Capabilities     | Big-endian `u32` capability bits                    |
| `V`  | Client list      | Connected client identities and lease state         |
| `K`  | Control changed  | Target `u64` after writer and resize transfer       |

A `Q` event can use multiple frames when its original SQLite payload plus the
sequence header would exceed 32 KiB. Each chunk repeats the event sequence.

## Client presence and control

Capability bit 0 advertises client presence and bit 1 advertises explicit
control transfer. After its attach request, a capable interactive client sends
one `N` payload:

```text
bytes 0–3    client process PID, big-endian signed i32
byte 4       UTF-8 display-name byte length (0–127)
bytes 5–7    reserved, zero
bytes 8…     display name
```

A control connection sends an empty `V` frame to list interactive attachments.
The response starts with a one-byte count followed by that many variable-length
records:

```text
bytes 0–7    client identifier, big-endian u64
bytes 8–11   client process PID, big-endian signed i32
bytes 12–19  connection time, Unix milliseconds, big-endian i64
byte 20      requested lease flags
byte 21      granted lease flags
byte 22      display-name byte length
bytes 23…    UTF-8 display name
```

Control connections are excluded from the list. A control client can send `K`
with an attached client identifier. The worker atomically moves both writer and
resize leases to that attachment, sends updated `L` status to the old and new
controllers, and acknowledges with `K`. The former controller remains connected
as a watcher.

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

Output batches use one monotonically increasing worker sequence. An attach
request names the last sequence whose effects the client has already applied.

- If that sequence is still inside the bounded in-memory history, the worker
  sends only newer `Q` output.
- If the in-memory boundary has passed it, the live worker sends a fresh `C`
  checkpoint at its current sequence.
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

The worker coalesces PTY reads for at most 16 ms or 256 KiB, then retains and
sends the batch under one output sequence. Raw output remains in memory rather
than being inserted into SQLite. After 4 MiB of PTY output by default
(configurable with `--checkpoint-bytes`, 32 KiB–16 MiB), or 60 seconds with
unsaved output, one SQLite transaction advances the durable sequence, replaces
the visible-screen checkpoint, and removes covered legacy events. A clean exit
also saves the final screen.

## Writer and resize leases

Writer and resize ownership are independent. The first eligible interactive
client receives each requested lease. A lease lasts 30 seconds and attach
clients send a heartbeat every 10 seconds. Input or resize activity also renews
ownership. Disconnecting releases ownership immediately; an attached waiter is
then granted the lease.

A client without the relevant lease remains a watcher. Current attach clients
honor `L` updates locally and discard terminal input while they are watchers,
so a revoked controller cannot keep writing or pollute its renderer with lease
diagnostics. `take` transfers both leases together; disconnect and expiry keep
the existing automatic handoff behavior. Same-user control connections remain
an explicit administrative path used by `send`, `signal`, `stop`, presence, and
control transfer.

## Disconnect and recovery boundary

A disconnect closes only that attachment. The worker continues draining the PTY,
retaining bounded resume output in memory, and periodically replacing its
durable visible-screen checkpoint. Worker writes to an attachment are bounded
to one second; a viewer that stops draining its socket is disconnected rather
than blocking PTY output, session control, or other attachments. Focus, smooth
scrolling, selection, and visual viewport are client-owned and never appear in
this protocol.

After reboot or worker loss, `reconcile` marks a formerly live record as
`orphaned` when its private socket is no longer reachable. The last durable
checkpoint remains attachable, but Machinen does not claim to recreate the lost
PTY or process. Restart is an explicit new-process action.
