# `@machinen/session`

Portable terminal session multiplexer and SQLite recovery core.

The installed `machinen-session` binary statically includes SQLite. It does not
depend on Node, SwiftTerm, Ghostty, AppKit, or a system SQLite installation.
It builds as an approximately 1 MB static Linux executable and a similarly sized
native macOS executable.

## Session ownership

The worker and database live on the host that owns the PTY. A session running on
an SSH host writes its recovery information on that host, not on the machine
displaying Machinen Desktop.

Each `new` command forks a detached worker. The worker owns one PTY, journals its
output, and listens on a user-private Unix socket. Closing every attach client
does not stop the worker or its child command. Up to eight clients can watch and
write to the same session concurrently.

```text
command ⇄ PTY ⇄ detached worker ⇄ Unix socket ⇄ attach client
                       │
                       └── SQLite output and resize journal
```

## CLI

The database's parent directory must already exist.

```sh
DB="$HOME/Library/Application Support/Machinen/sessions.sqlite3"

machinen-session database init "$DB"

machinen-session new \
  --database "$DB" \
  --id api \
  --name api \
  --cwd "$HOME/project" \
  -- pnpm dev

machinen-session list --database "$DB"
machinen-session attach --database "$DB" api
```

`attach` puts an interactive terminal into raw mode, forwards its initial size
and `SIGWINCH` changes, and restores the original terminal mode on normal exit.
A newly attached client receives all retained output before joining the live
stream. Session lookup accepts either an ID or a unique name.

Suggested database locations:

- macOS: `~/Library/Application Support/Machinen/sessions.sqlite3`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/machinen/sessions.sqlite3`

## Durable data

The store contains:

- Session identity, command, working directory, state, and canonical PTY size.
- Byte-exact output chunks and resize events in one monotonically ordered stream.
- Versioned, renderer-neutral terminal checkpoints.

A connected renderer keeps its own smooth viewport. After a brief disconnect it
can request events after its last sequence. A fresh attach currently replays the
retained output journal. The storage API supports checkpoints and atomic
compaction; generation of portable VT checkpoints is a later renderer-neutral
slice.

## Storage invariants

- SQLite runs in WAL mode with foreign keys enabled and a five-second busy timeout.
- The database and session sockets are forced to mode `0600`; the runtime socket
  directory is forced to `0700`.
- Each session has an independently increasing event sequence.
- Resize metadata and its event are committed atomically.
- Checkpoint compaction is allowed only for a checkpoint that exists in the same
  session.
- Schema migrations are tracked with `PRAGMA user_version`; the database is
  tagged with a Machinen-specific `application_id`.
- Database payloads are BLOBs so PTY output is never treated as UTF-8 text.

## Current boundary

This implementation survives Desktop exits, attach-client exits, and SSH
transport disconnections. It does not yet promise survival across a session
worker crash or host reboot: SQLite preserves recovery data, but a live PTY file
descriptor cannot be recreated after its owner dies.

Still to add:

- Default platform database discovery and automatic state-directory creation.
- Stop, signal, send, and garbage-collection commands.
- Bounded output retention, compression, and portable VT checkpoint generation.
- Writer/resize leases instead of last-writer-wins multi-client input.
- Desktop's `TerminalSessionBackend` adapter and automatic remote installation.

## Development

```sh
pnpm -F @machinen/session test
pnpm -F @machinen/session build
```

## Vendored SQLite

SQLite 3.51.0 is vendored from the official amalgamation at
<https://www.sqlite.org/2025/sqlite-amalgamation-3510000.zip> and compiled into
the binary with extension loading disabled.

Archive SHA-256:

```text
1caf7116f2910600d04473ad69d37ec538fa62fa36adccd37b5e0e43647c98be
```

SQLite is in the public domain: <https://www.sqlite.org/copyright.html>.
