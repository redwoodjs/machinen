# `@machinen/session`

Portable persistence core for the Machinen terminal multiplexer.

The installed `machinen-session` binary statically includes SQLite. It does not
depend on Node, SwiftTerm, Ghostty, AppKit, or a system SQLite installation.
The current slice provides the durable storage boundary; PTY ownership, attach
transport, and the public session-management commands will be layered on top.

## Durable ownership

The database lives on the host that owns the PTY. A session running on an SSH
host writes its recovery information on that host, not on the machine displaying
Machinen Desktop.

Suggested locations:

- macOS: `~/Library/Application Support/Machinen/sessions.sqlite3`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/machinen/sessions.sqlite3`

The store contains:

- Session identity, command, working directory, state, and canonical PTY size.
- Byte-exact output chunks and resize events in one monotonically ordered stream.
- Versioned, renderer-neutral terminal checkpoints.

A connected renderer keeps its own smooth viewport. After a brief disconnect it
requests events after its last sequence. A fresh renderer loads the latest
checkpoint and then replays the events after that checkpoint.

## Storage invariants

- SQLite runs in WAL mode with foreign keys enabled and a five-second busy timeout.
- Each session has an independently increasing event sequence.
- Resize metadata and its event are committed atomically.
- Checkpoint compaction is allowed only for a checkpoint that exists in the same
  session.
- Schema migrations are tracked with `PRAGMA user_version`; the database is
  tagged with a Machinen-specific `application_id`.
- Database payloads are BLOBs so PTY output is never treated as UTF-8 text.

## Development

```sh
pnpm -F @machinen/session test
pnpm -F @machinen/session build

./packages/session/zig-out/bin/machinen-session \
  database init /tmp/machinen-sessions.sqlite3
```

`database init` and `database status` are intentionally narrow inspection
commands for this first slice. They do not claim to create or attach a PTY
session yet.

## Vendored SQLite

SQLite 3.51.0 is vendored from the official amalgamation at
<https://www.sqlite.org/2025/sqlite-amalgamation-3510000.zip> and compiled into
the binary with extension loading disabled.

Archive SHA-256:

```text
1caf7116f2910600d04473ad69d37ec538fa62fa36adccd37b5e0e43647c98be
```

SQLite is in the public domain: <https://www.sqlite.org/copyright.html>.
