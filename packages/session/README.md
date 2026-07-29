# `@machinen/session`

Portable terminal session multiplexer and bounded SQLite recovery core.

The installed `machinen-session` binary statically includes SQLite. It does not
depend on Node, SwiftTerm, Ghostty, AppKit, or a system SQLite installation. It
builds as an approximately 1 MB static Linux executable and a similarly sized
native macOS executable.

## Workspace and session identity

The workers and shared database live on the host that owns the PTYs. A session
running on an SSH host writes workspace, membership, and recovery information on
that host, not on the machine showing Machinen Desktop.

The database is also the mutable workspace registry. A workspace record contains
a stable ID, display name, and directory root; each session optionally carries an
explicit `workspace_id`. This lets a fresh Desktop reconstruct local workspaces,
or restore a remote workspace after the user selects its SSH directory, without
depending on that Desktop's private manifest. The directory remains the tangible
anchor while SQLite serializes mutable names, roots, and membership.

Each `new` command creates a stable session ID and can optionally assign a unique name.
Every later operation resolves either value:

```sh
machinen-session list --database "$DB"
machinen-session attach --database "$DB" term_01234567
machinen-session attach --database "$DB" api       # unique name
```

Desktop may cache the terminal ID and tile arrangement in `terminals.json`, but
the native workspace and session records are authoritative for discovery.
Reopening the scene uses the stable ID to attach to the same worker. IDs do not
depend on a PID, socket inode, window, SSH connection, or Desktop process.

Each detached worker owns one PTY, keeps a bounded output journal in memory, and
listens on a user-private Unix socket. Closing every client does not stop its
command. Up to eight clients can watch a session concurrently.

```text
command ⇄ PTY ⇄ detached worker ⇄ Unix socket ⇄ attach client
                       │
                       ├── bounded in-memory ordered journal
                       └── SQLite visible-screen checkpoint
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
machinen-session database status "$DB"
# Stop every session before explicitly reclaiming an old database high-water mark:
machinen-session database compact "$DB"
machinen-session workspace save \
  --database "$DB" \
  --id ws-project \
  --name project \
  --root "$HOME/project"
machinen-session workspace list --database "$DB"
machinen-session new \
  --database "$DB" \
  --id api-1 \
  --name api \
  --workspace-id ws-project \
  --workspace-name project \
  --workspace-root "$HOME/project" \
  --cwd "$HOME/project" \
  -- pnpm dev

machinen-session list --database "$DB"
machinen-session inspect --database "$DB" api
machinen-session attach --database "$DB" api
machinen-session attach --database "$DB" --latest-screen api
machinen-session attach --database "$DB" --after 420 api
printf 'r' | machinen-session send --database "$DB" api
machinen-session stop --database "$DB" api
```

Suggested database locations:

- macOS: `~/Library/Application Support/Machinen/sessions.sqlite3`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/machinen/sessions.sqlite3`

## Resume and bounded recovery

Protocol-v2 output carries its worker sequence. A reconnecting client sends its
last applied sequence. The worker sends only newer output when its bounded
in-memory history still covers that point. Otherwise it sends a fresh portable
VT checkpoint from the live screen.

Checkpoint format v1 is an ordinary VT reconstruction stream containing reset,
visible UTF-8 cells, and cursor position. It is renderer-neutral: Ghostty or
another terminal can consume it as output. Selection, visual viewport, title,
and styling remain outside the v1 checkpoint.

PTY reads are coalesced in memory for at most 16 ms or 256 KiB before receiving
one sequence and being sent to viewers. This keeps latency below one display
frame and retains up to 16 MiB of live resume history without writing raw PTY
output to disk.

A worker persists its current visible-screen checkpoint after 4 MiB of output by
default or after 60 seconds with unsaved output. Use `--checkpoint-bytes` to
select 32 KiB–16 MiB. The checkpoint transaction advances the durable sequence,
replaces the older screen, and drops covered legacy events. A clean worker exit
also writes its final screen. Raw TUI
redraw traffic therefore stays in memory instead of being written and deleted
through SQLite; after an unexpected worker loss, recovery shows the last durable
visible screen rather than a byte-exact disk transcript.

New databases use incremental auto-vacuum metadata and cap retained WAL files at
8 MiB. SQLite reuses deleted journal pages instead of repeatedly returning and
reallocating them, minimizing filesystem and SSD write amplification. The
explicit `database compact` operation rebuilds an idle database when an older
version already left a large physical high-water mark; it refuses to vacuum
while any session is live.

`attach --latest-screen` asks a live worker to generate an ephemeral checkpoint
from its current in-memory VT state. It skips retained journal output, so a new
renderer can show the current screen and begin consuming live output without
waiting to reconstruct scrollback. Normal attach and `--after` retain their
journal-resume behavior.

## Multiple clients

Writer and resize leases prevent two interactive clients from fighting over one
PTY. The first client receives each requested lease, renews it with 10-second
heartbeats, and releases it on disconnect. Other attachments continue as
watchers and automatically acquire a released lease. `attach --read-only`
requests neither lease.

Same-user `send`, `signal`, and `stop` operations use explicit control
connections. They do not steal the interactive writer lease.

## Foreground activity

`inspect` asks the worker that owns the PTY for its login-shell PID, foreground
process-group leader, process names, and `idle`/`working` state. This works on
local and SSH-owned sessions without inspecting processes from Desktop. A live
worker from an older protocol reports `unknown` until the user explicitly
restarts that session; upgrading Desktop never replaces a running PTY.

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

- SQLite uses WAL mode, foreign keys, a five-second busy timeout, and an 8 MiB journal-size limit.
- New databases use incremental auto-vacuum; physical compaction remains an explicit idle operation.
- Small PTY reads share one in-memory sequence within a 16 ms / 256 KiB output batch.
- Raw live output is retained in memory, not SQLite; SQLite receives bounded visible-screen checkpoints.
- Database and session sockets are forced to mode `0600`; the runtime socket
  directory is forced to `0700`.
- Live output batches use an independently increasing worker sequence.
- A durable checkpoint advances its sequence and terminal dimensions atomically.
- Checkpoint replacement and legacy event compaction are committed atomically.
- SQLite records worker protocol versions so upgraded clients can attach to
  still-live v1 workers without replacing them.
- Schema migrations are tracked with `PRAGMA user_version`; the database carries
  a Machinen-specific `application_id`.
- Workspace updates and session membership use the same foreign-key-enabled
  SQLite store as recovery metadata. Deleting a workspace preserves its session
  records while clearing their membership.
- Legacy PTY events and checkpoint payloads are BLOBs and are never assumed to be UTF-8.

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
