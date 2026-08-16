# Authoritative Machinen server

## Goal

Use one server as the authority for all shared Machinen state.

Every Desktop client connects to this server. Every client shows the same workspaces, tiles, terminals, and selected view.

The server runs on a configured machine. Use the Mac mini as the default host.

## State ownership

The server owns these records:

- Machine identities and connection details
- Workspace identities, names, order, and locations
- Tile identities, labels, order, and layout
- Terminal identities, launch details, and lifecycle state
- Tile and terminal membership
- Terminal host ownership
- Placement settings
- Shared status data
- Camera level, selection, and focus

An execution host owns these resources:

- The terminal process
- The PTY
- The live output journal
- The visible screen checkpoint
- Process signals
- Terminal size control

A Desktop client owns only local interface settings. These settings include its window frame and display choice.

## Server configuration

Add one setting for the server address.

Use this selection order:

1. Use an explicit command option.
2. Use the `MACHINEN_SERVER` environment variable.
3. Use the saved user setting.
4. Use the local machine when no value exists.

Support a local Unix socket. Use SSH for a remote server connection.

Do not select the server from the Desktop location.

## Access

Give the server, each client, and each execution host a stable identifier.

Use the operating-system user for local access. Use the SSH user for remote access.

Reject changes from an unknown client. Store the client identifier with each accepted change.

## Storage

Store all shared state in one SQLite database on the server host.

Use one transaction for each state change. Add a monotonic revision number to the shared state.

Keep a bounded change log for client updates. Each change contains these fields:

- Revision number
- Change type
- Record identifier
- Client identifier
- Server timestamp
- Change data

Keep the current state in normal tables. Do not rebuild the state from the change log during server start.

## Client synchronization

A Desktop client requests one atomic snapshot after connection. The snapshot includes its revision number.

The client then subscribes to changes after that revision. The server sends changes in revision order.

The client requests a new snapshot after a revision gap.

The client can keep a read-only cache for fast startup. It marks the cache as stale until server confirmation.

Do not store shared state in `terminals.json`. Store only local interface settings in that file.

## Shared changes

Send every shared change to the server. These changes include workspace creation, tile movement, terminal creation, and focus changes.

The server validates each request. It applies one transaction and returns the new revision.

Use idempotency keys for retried changes. Return the first result for a repeated key.

Do not update the Desktop model before server acceptance. Show a pending state while the request runs.

## Terminal creation

Use this sequence:

1. The client sends a terminal creation request.
2. The server selects an execution host.
3. The server reserves a terminal identifier and host lease.
4. The selected host starts the session worker.
5. The host reports the result.
6. The server stores the terminal state.
7. The server publishes the new tile and terminal.

Mark the terminal as failed when host startup fails. Do not report a running terminal before host confirmation.

## Terminal attachment

A Desktop client asks the server for an attachment route. The server returns the execution host and session identifier.

The client connects to the approved route. The server remains authoritative for attachment and control leases.

A lost Desktop connection does not stop the terminal. A lost server connection does not stop an active terminal process.

## Machine records

Each execution host reports these facts:

- Operating system
- CPU architecture
- Available CPU capacity
- Available memory
- Power source
- Session count
- Supported capabilities
- Last report time

Store the latest report on the server. Mark a host as unavailable after the report timeout.

Use an explicit host choice and a simple default host.

## Failure behavior

A client shows the server connection state. It disables shared changes while the server is unavailable.

An execution host keeps its terminal sessions active during a server outage. It reports its current sessions after reconnection.

The server compares each report with its terminal records. It never creates a duplicate process during this check.

Back up the database with the SQLite backup interface or a safe database snapshot.

## Migration

Use this sequence:

1. Back up the Desktop manifest and session database.
2. Start the server on the selected host.
3. Import workspace and session records.
4. Import Desktop layout records.
5. Match records with stable identifiers.
6. Flag unclear records for user review.
7. Connect Desktop to the server.
8. Keep the old files as read-only backups.

Do not match records by display name alone. Use stable identifiers and exact host ownership.

## Acceptance checks

The implementation must pass these checks:

- Two Desktop clients show the same workspace order and tile layout.
- A change from either client appears on the other client.
- Both clients attach to the same terminal process.
- A Desktop restart does not change shared state.
- A server restart preserves all saved state.
- A client reconnect recovers from a missed revision.
- A repeated request does not create a duplicate record.
- A server outage does not stop terminal processes.
- A host outage shows unavailable terminals without false success.

## Code structure

The server contains these separate modules:

- Workspace store
- Machine registry
- Terminal scheduler
- Session multiplexer
- Client API

Keep terminal execution separate from shared state authority. Keep a clear protocol boundary between the modules.
