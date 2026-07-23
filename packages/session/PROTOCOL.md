# Machinen Session protocol v1

A session worker listens on a same-user Unix stream socket:

```text
/tmp/machinen-session-<uid>/<session-id>.sock
```

The directory has mode `0700` and each socket has mode `0600`. Session IDs are
limited to 64 ASCII letters, digits, dots, underscores, and hyphens.

## Framing

Every frame starts with a five-byte header:

```text
byte 0      frame kind
bytes 1–4   unsigned payload length, big-endian
bytes 5…    payload
```

Payloads are limited to 32 KiB. Terminal data is opaque bytes, not text.

## Client to worker

| Kind | Name   | Payload                                      |
| ---- | ------ | -------------------------------------------- |
| `I`  | Input  | Bytes to write to the PTY                    |
| `R`  | Resize | Big-endian `u16 columns`, `u16 rows`         |
| `S`  | Signal | Big-endian signed 32-bit POSIX signal number |

## Worker to client

| Kind | Name             | Payload                              |
| ---- | ---------------- | ------------------------------------ |
| `O`  | Output           | Bytes read from the PTY              |
| `H`  | History complete | Empty; subsequent output is live     |
| `X`  | Exit             | Big-endian signed 32-bit exit status |
| `E`  | Failure          | UTF-8 diagnostic for display         |

Immediately after accepting a client, the worker sends retained `O` frames in
SQLite event-sequence order, followed by `H`. PTY output produced afterward is
journaled before being broadcast as live `O` frames.

A disconnect has no session-side meaning. It closes only that attachment; the
worker continues draining and journaling the PTY. Focus and visual scroll
position are client-owned and never appear in this protocol.

## Resizing

Every valid `R` frame updates the canonical PTY size with `TIOCSWINSZ` and
atomically appends a resize event to SQLite. The current implementation is
last-writer-wins. A later protocol version can add explicit writer and resize
leases without changing session identity or recovery storage.

## Recovery

Output and resize events share one monotonically increasing sequence. The
current worker replays retained output from sequence zero for a fresh client.
The SQLite API also supports renderer-neutral checkpoints and replay after a
checkpoint sequence; checkpoint generation and negotiation are reserved for a
later protocol version.
