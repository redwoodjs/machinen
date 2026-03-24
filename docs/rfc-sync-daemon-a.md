# RFC: `machinen sync` — Standalone Checkpoint Sync Daemon

**Status:** Draft A
**Date:** 2026-03-23

---

## 2000ft View Narrative

The `machinen restore` command is currently only useful immediately after a `machinen freeze`. If the user wants to restore hours later on a remote server, they must first freeze again — which stops the container and incurs significant latency. The fix is a long-lived background process that continuously keeps the registry up to date while the container is running.

`machinen sync [container-name]` is that process. It runs in the foreground, syncing a running devcontainer's checkpoint to ghcr.io every 5 minutes (configurable). When the user later runs `machinen restore`, the latest image is already in the registry and the restore is immediate.

The core sync logic already exists in `src/sync.mjs`. This RFC surfaces it as a user-facing command with proper CLI ergonomics, signal handling, and a status file that `restore` can query to detect staleness.

---

## Relevant Learnings & Decisions

### Codebase artifacts consulted

**`src/sync.mjs`**
Contains `startBackgroundSync(containerName, registry, ip)`. Key observations:
- `SYNC_INTERVAL` is a module-level constant (`5 * 60 * 1000`); not injectable.
- The first sync fires after a 30-second delay (`setTimeout(sync, 30 * 1000)`) — described as "let user get settled." This is an artifact, not a deliberate UX choice.
- `stop()` sets `running = false` and clears the timer, but does not wait for an in-progress sync to finish.
- `syncNow()` is used to force a sync before sleep handoff.
- The registry path used is `${registry}/${containerName}:*`, where `registry` comes from the caller.

**`src/registry.mjs`**
`getRegistry()` calls `gh api user`, `gh auth token`, and `gh auth status`. Auth failures throw a `new Error(...)` with a descriptive message including "write:packages". This is the auth-failure detection point — no lower-level registry client to interrogate.

**`src/machinen.mjs`**
- Uses a flat manual arg parser (`parseArgs`). Flags that have a value use `--flag value`; boolean flags use `--flag`.
- Container detection: `currentContainerName()` derives from `git rev-parse --abbrev-ref HEAD` → `machinen-<branch>`. This only works in a git repo.
- Container existence check pattern in `cmdOpen`: `docker inspect --format '{{.State.Status}}' <name>` — if it throws, the container doesn't exist; if it returns `"running"`, it's live.
- Help text is printed by the `main()` function when `action` is unrecognized. New commands must be added to the `commands` object and the help string.

### Decision log

| Open question | Decision | Rationale |
|---|---|---|
| Docker API for container existence | `execSync(docker inspect ...)` | Matches existing CLI patterns; no new dependencies |
| `--registry` override flag | Omitted in v1 | Not in synthesis; adds complexity; `getRegistry()` is the right source of truth |
| Auth-failure detection | Parse error message from `getRegistry()` / `pushImage` for known auth strings | No richer API surface available; pattern is already used implicitly |
| `--remote` vs `--remote-ip` | `--remote` | Shorter; synthesis uses this form |
| `version` field in status file | Include as `"1"` | Cheap to add now; allows future schema migrations |
| `src/sync.mjs` interval interaction | Refactor `startBackgroundSync` to accept `intervalMs` option | Cleaner than reimplementing the loop; existing callers can pass `undefined` to get the default |

---

## Implementation Breakdown

### [MODIFY] `src/sync.mjs`

Extend `startBackgroundSync` signature to accept an optional options object:

```js
export function startBackgroundSync(containerName, registry, ip, opts = {})
```

Where `opts`:
- `intervalMs` — sync interval in ms (default: `5 * 60 * 1000`)
- `immediate` — if `true`, fire first sync immediately instead of after 30s (default: `false`)
- `onSyncStart` — callback `() => void` called before each sync attempt
- `onSyncComplete` — callback `({ success, error, checkpointId }) => void` called after each attempt
- `onSkipped` — callback `() => void` called when a sync is skipped due to in-progress guard

Add a concurrency guard (`let syncing = false`) to skip the interval tick if a sync is already running. Call `onSkipped` in this case.

Return the existing `{ stop(), syncNow() }` shape. Add `stop()` returning a `Promise` that resolves when any in-flight sync completes.

### [NEW] `src/cmd-sync.mjs`

New module that implements the `sync` command logic. This keeps `machinen.mjs` from growing further. It exports a single function:

```js
export async function cmdSync(args)
```

Responsibilities:
1. Parse and validate `--interval`, `--once`, `--remote` flags
2. Validate auth via `getRegistry()` at startup
3. Resolve container name (explicit arg → verify via Docker; no arg → auto-detect)
4. Start sync via `startBackgroundSync` with callbacks
5. Write and maintain the status file
6. Handle SIGINT/SIGTERM: wait for in-flight sync, update status file, exit 0
7. Exit 1 after 3 consecutive auth failures

### [MODIFY] `src/machinen.mjs`

- Import `cmdSync` from `./cmd-sync.mjs`
- Add `sync: cmdSync` to the `commands` object
- Add `sync` to the help text with flag documentation

---

## Behavior Spec

```gherkin
Feature: machinen sync daemon

  # ── CLI Surface ──────────────────────────────────────────────────────────────

  Scenario: sync appears in top-level help
    When the user runs `machinen` with no arguments
    Then stdout contains "sync"

  Scenario: sync --help shows usage
    When the user runs `machinen sync --help`
    Then output contains "sync", "interval", and "--once"
    And the process exits 0

  # ── Container resolution ─────────────────────────────────────────────────────

  Scenario: no container, not in git repo
    Given the user is not in a git repository
    And no container name is passed
    When the user runs `machinen sync`
    Then stderr contains "container"
    And the process exits 1

  Scenario: explicit container does not exist
    Given the container "nonexistent_xyz" is not running in Docker
    When the user runs `machinen sync nonexistent_xyz`
    Then the process exits 1

  Scenario: explicit container exists
    Given the container "my-dev" is running in Docker
    When the user runs `machinen sync my-dev`
    Then the daemon starts and logs "my-dev" in the startup message

  Scenario: no container name, devcontainer running
    Given the user is in a git repo on branch "main"
    And a container named "machinen-main" is running
    When the user runs `machinen sync`
    Then the daemon uses container "machinen-main"

  # ── Interval validation ───────────────────────────────────────────────────────

  Scenario: non-numeric interval
    When the user runs `machinen sync --interval abc`
    Then the process exits 1

  Scenario: zero interval
    When the user runs `machinen sync --interval 0`
    Then the process exits 1

  Scenario: interval below minimum (< 30)
    When the user runs `machinen sync --interval 10`
    Then the process exits 1
    And output matches /interval.*minimum|minimum.*interval/i

  Scenario: valid interval passes validation
    When the user runs `machinen sync --interval 60` with no resolvable container
    Then the process exits 1 for a container reason, NOT an interval reason

  Scenario: interval from environment variable
    Given MACHINEN_SYNC_INTERVAL=120 is set
    When the user runs `machinen sync`
    Then the daemon uses a 120-second interval

  # ── Startup behavior ──────────────────────────────────────────────────────────

  Scenario: daemon logs configuration on startup
    Given a container "my-dev" is running
    When the user runs `machinen sync my-dev --interval 60`
    Then stdout contains the container name, registry URL, and interval before the first sync

  Scenario: first sync is immediate
    Given a container "my-dev" is running
    When the user runs `machinen sync my-dev`
    Then a sync attempt begins within 1 second of startup (not after a 30s delay)

  # ── --once flag ───────────────────────────────────────────────────────────────

  Scenario: --once with no container exits without hanging
    Given no container is resolvable
    When the user runs `machinen sync --once`
    Then the process exits without being signaled (not a hang)

  Scenario: --once with invalid interval rejected
    When the user runs `machinen sync --once --interval xyz`
    Then the process exits 1

  Scenario: --once runs exactly one sync and exits (E2E)
    Given a container "my-dev" is running and registry auth is valid
    When the user runs `machinen sync my-dev --once`
    Then exactly one sync is performed
    And the process exits 0 after completion

  # ── Output format ─────────────────────────────────────────────────────────────

  Scenario: log lines use ISO timestamp format
    Given a sync daemon is running
    When any log line is emitted
    Then it matches `[ISO-timestamp] [LEVEL] message`

  Scenario: successful sync emits completion line
    Given a successful sync completes
    Then stdout contains "[INFO] Sync complete. Restore is ready."

  Scenario: failed sync emits error line
    Given a sync attempt fails
    Then stderr contains "[ERROR] Sync failed:"

  # ── Signal handling ───────────────────────────────────────────────────────────

  Scenario: SIGINT terminates the daemon
    When the daemon receives SIGINT
    Then the process terminates within 5 seconds

  Scenario: SIGTERM terminates the daemon
    When the daemon receives SIGTERM
    Then the process terminates within 5 seconds

  Scenario: signal during idle exits 0
    Given the daemon is between syncs
    When it receives SIGINT
    Then it exits 0

  Scenario: signal during sync waits for completion (E2E)
    Given a sync is in progress
    When the daemon receives SIGTERM
    Then it waits for the current sync to finish before exiting

  # ── Status file ───────────────────────────────────────────────────────────────

  Scenario: status file written after first sync (E2E)
    Given a sync completes successfully
    Then `~/.local/share/machinen/<container>/sync-status.json` exists
    And it contains: pid, container, registry, lastSync (ISO), lastSyncSuccess (bool), syncCount (int), version ("1")

  Scenario: status file updated after each sync (E2E)
    Given two syncs have completed
    Then `syncCount` equals 2
    And `lastSync` reflects the second sync time

  Scenario: status file persists after daemon exits (E2E)
    Given the daemon has synced at least once
    When the daemon is sent SIGTERM
    Then the status file still exists on disk after the process exits

  # ── Error recovery ────────────────────────────────────────────────────────────

  Scenario: daemon continues after transient sync failure (E2E)
    Given a sync fails due to a network error
    Then the daemon logs the error
    And schedules the next sync at the normal interval
    And does not exit

  Scenario: daemon exits after 3 consecutive auth failures (E2E)
    Given 3 consecutive syncs fail with authentication errors
    Then the daemon exits 1 with a message about authentication

  # ── restore integration ───────────────────────────────────────────────────────

  Scenario: restore uses registry without requiring daemon (E2E)
    Given the sync daemon has pushed at least one image
    And the daemon has been stopped
    When the user runs `machinen restore`
    Then it succeeds using the last pushed image

  Scenario: restore warns on stale status file (E2E)
    Given `sync-status.json` has a `lastSync` older than 10 minutes
    When the user runs `machinen restore`
    Then stdout or stderr contains a stale warning
    And restore proceeds regardless
```

---

## Types & Data Structures

### Status file: `~/.local/share/machinen/<container>/sync-status.json`

```ts
interface SyncStatus {
  version: "1";                 // Schema version for future migrations
  pid: number;                  // PID of the running daemon (stale after exit)
  container: string;            // Container name
  registry: string;             // Registry prefix (e.g. ghcr.io/user)
  lastSync: string | null;      // ISO 8601 UTC timestamp of last sync attempt
  lastSyncSuccess: boolean | null; // null until first attempt completes
  syncCount: number;            // Total successful syncs in this session
}
```

The file is written atomically (write to `.tmp` then rename) to avoid partial reads by `restore`.

### Auth failure tracking (in-memory only)

```ts
let consecutiveAuthFailures = 0;
const AUTH_FAILURE_EXIT_THRESHOLD = 3;

function isAuthError(err: Error): boolean {
  return /denied|unauthorized|401|403|credentials|write:packages/i.test(err.message);
}
```

---

## Invariants & Constraints

1. **Resolution before loop:** Container must be verified to exist before the sync loop starts. Never enter the loop then discover the container is gone.
2. **Interval minimum:** `--interval` must be ≥ 30 seconds. Values below this exit 1 before any sync.
3. **Immediate first sync:** First sync fires immediately (no 30-second settle delay). This overrides the existing behavior in `src/sync.mjs`.
4. **Concurrency guard:** If a sync is still running when the next interval fires, skip it and log `[WARN] Previous sync still in progress, skipping interval`. Never run two syncs concurrently.
5. **Auth checked once:** `getRegistry()` is called at startup only. Credential rotation during a session is handled via the consecutive-auth-failure exit path.
6. **Status file never deleted:** The file persists after daemon exit. `restore` may read it at any time.
7. **Status file written atomically:** Write to `<path>.tmp` then `fs.renameSync` to avoid torn reads.
8. **SIGINT/SIGTERM behavior:** Wait for in-flight sync; do not start new syncs; update status file; exit 0. No "final sync on shutdown."
9. **`--once` behavior:** Run exactly one sync, then exit 0 (success) or exit 1 (failure). Do not enter the interval loop.

---

## Tasks

- [ ] **T1:** Refactor `src/sync.mjs` — extend `startBackgroundSync` to accept `opts` (`intervalMs`, `immediate`, `onSyncStart`, `onSyncComplete`, `onSkipped`); add concurrency guard; make `stop()` return a Promise
- [ ] **T2:** Create `src/cmd-sync.mjs` — arg parsing, container resolution, auth validation, status file logic, signal handling
- [ ] **T3:** Wire `sync` command into `src/machinen.mjs` — add to `commands` map and help text
- [ ] **T4:** Implement stale-status warning in `cmdRestore` in `src/machinen.mjs`
- [ ] **T5:** Run existing test suite; fix any regressions
- [ ] **T6:** Verify tests in `src/__tests__/sync-daemon.test.mjs` pass

---

## Open Questions (Resolved)

All open questions from the synthesis have been resolved above. No blockers remain for implementation.
