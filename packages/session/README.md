# `@machinen/session`

Portable terminal session multiplexer and bounded SQLite recovery core.

The installed `machinen-session` binary statically includes SQLite. It does not
depend on Node, SwiftTerm, Ghostty, AppKit, or a system SQLite installation. It
builds as an approximately 1 MB static Linux executable and a similarly sized
native macOS executable.

## Session identity and ownership

The worker and database live on the host that owns the PTY. A session running on
an SSH host writes recovery information on that host, not on the machine showing
Machinen Desktop.

Each `new` command creates a stable ID and can optionally assign a unique name.
Every later operation resolves either value:

```sh
machinen-session list --database "$DB"
machinen-session attach --database "$DB" term_01234567
machinen-session attach --database "$DB" api       # unique name
```

Desktop persists the terminal ID in `terminals.json`; reopening the scene uses
that ID to attach to the same worker. IDs do not depend on a PID, socket inode,
window, SSH connection, or Desktop process.

Each detached worker owns one PTY, journals output, and listens on a user-private
Unix socket. Closing every client does not stop its command. Up to eight clients
can watch a session concurrently.

```text
command ⇄ PTY ⇄ detached worker ⇄ Unix socket ⇄ attach client
                       │
                       └── SQLite checkpoint + ordered journal
```

## Main Machinen CLI

The main Node CLI supplies the platform database location, creates its secure
state directory, finds the helper bundled in the matching native npm package,
and delegates the PTY data plane to the native binary:

```sh
machinen terminal new --name api --cwd "$HOME/project" -- pnpm dev
machinen terminal list
machinen terminal attach api
machinen terminal send api --newline r
machinen terminal signal api interrupt
machinen terminal stop api
machinen terminal delete api
machinen terminal reconcile
machinen terminal gc --older-than 604800
```

`MACHINEN_SESSION_DATABASE` and `--database` override the default database.
`MACHINEN_SESSION_HELPER` overrides native-helper discovery.

## Native CLI

The lower-level binary remains independently usable:

```sh
DB="$HOME/Library/Application Support/Machinen/sessions.sqlite3"
mkdir -p "$(dirname "$DB")"

machinen-session database init "$DB"
machinen-session new \
  --database "$DB" \
  --id api-1 \
  --name api \
  --cwd "$HOME/project" \
  -- pnpm dev

machinen-session list --database "$DB"
machinen-session attach --database "$DB" api
machinen-session attach --database "$DB" --after 420 api
printf 'r' | machinen-session send --database "$DB" api
machinen-session stop --database "$DB" api
```

Suggested database locations:

- macOS: `~/Library/Application Support/Machinen/sessions.sqlite3`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/machinen/sessions.sqlite3`

## Resume and bounded recovery

Protocol-v2 output carries its SQLite sequence. A reconnecting client sends its
last applied sequence. The worker sends only newer output when retained history
still covers that point. Otherwise it sends the latest portable VT checkpoint
before the remaining output.

Checkpoint format v1 is an ordinary VT reconstruction stream containing reset,
visible UTF-8 cells, and cursor position. It is renderer-neutral: SwiftTerm or
another terminal can consume it as output. Selection, visual viewport, title,
and styling remain outside the v1 checkpoint.

A worker checkpoints every 256 KiB of output by default. Use
`--checkpoint-bytes` to select 32 KiB–16 MiB. Replacing the checkpoint and
deleting covered events is atomic. Recovery storage is bounded to one visible
screen checkpoint plus output produced since the latest checkpoint.

## Multiple clients

Writer and resize leases prevent two interactive clients from fighting over one
PTY. The first client receives each requested lease, renews it with 10-second
heartbeats, and releases it on disconnect. Other attachments continue as
watchers and automatically acquire a released lease. `attach --read-only`
requests neither lease.

Same-user `send`, `signal`, and `stop` operations use explicit control
connections. They do not steal the interactive writer lease.

## Reboot-aware reconciliation and cleanup

`reconcile` checks records marked `created` or `running` against their same-user
worker socket. An unreachable record becomes `orphaned`, its stale socket is
removed, and its durable checkpoint remains available.

`gc` first reconciles, then removes exited, stopped, or orphaned records older
than seven days. `--older-than <seconds>` changes that age and `--dry-run`
previews existing cleanup candidates.

This is deliberately not PTY resurrection. A checkpoint can reconstruct what a
client saw; it cannot recreate the lost process, kernel PTY state, file
descriptors, or network connections. Restarting after worker loss starts a new
process explicitly.

## Storage invariants

- SQLite uses WAL mode, foreign keys, and a five-second busy timeout.
- Database and session sockets are forced to mode `0600`; the runtime socket
  directory is forced to `0700`.
- Output and resize events share an independently increasing session sequence.
- Resize metadata and its event are committed atomically.
- Checkpoint replacement and event compaction are committed atomically.
- SQLite records worker protocol versions so upgraded clients can attach to
  still-live v1 workers without replacing them.
- Schema migrations are tracked with `PRAGMA user_version`; the database carries
  a Machinen-specific `application_id`.
- PTY output and checkpoint payloads are BLOBs and are never assumed to be UTF-8.

## Development

```sh
pnpm -F @machinen/session test
pnpm -F @machinen/session build
```

See [`PROTOCOL.md`](./PROTOCOL.md) for frame-level details.

## Pinned SQLite build dependency

Zig fetches SQLite 3.51.0 from the official autoconf source archive and caches
it by content hash. `build.zig` compiles the archive's amalgamated `sqlite3.c`
directly into `machinen-session` with runtime extension loading disabled. The
shipped binary therefore has no runtime SQLite or network dependency.

- Source: <https://www.sqlite.org/2025/sqlite-autoconf-3510000.tar.gz>
- Archive SHA-256: `42e26dfdd96aa2e6b1b1be5c88b0887f9959093f650d693cb02eb9c36d146ca5`
- `sqlite3.c` SHA-256: `dc58f0b5b74e8416cc29b49163a00d6b8bf08a24dd4127652beaaae307bd1839`
- `sqlite3.h` SHA-256: `05c48cbf0a0d7bda2b6d0145ac4f2d3a5e9e1cb98b5d4fa9d88ef620e1940046`
- Zig package hash: `N-V-__8AAEX4vgBcl2OX6nCrfasAkbYDFSlDut77e0uEwXFm`
- License: SQLite is in the public domain: <https://www.sqlite.org/copyright.html>
