# RFC: `machinen sync` — Standalone Checkpoint Sync Daemon

**Status:** Draft B
**Date:** 2026-03-23

---

## 2000ft View Narrative

`machinen restore` is only useful right after a freeze. If you want to restore hours later, you have to freeze again — which stops your container and takes significant time. The solution is a long-lived process that keeps the registry current while the container is running.

`machinen sync [container-name]` is that process. It runs in the foreground, periodically pushing the container's checkpoint to ghcr.io so that `restore` can always pull the latest image immediately.

**Where Draft B diverges from Draft A:**

1. **Don't refactor `src/sync.mjs`.** That module was designed for the sleep/wake handoff in `cmdUp` — it has a 30-second "let user get settled" delay, no callback surface, and its stop() doesn't wait for in-flight work. Rather than retrofitting it with an `opts` parameter, Draft B implements the sync loop directly in the command using the lower-level `docker.mjs` primitives that `src/sync.mjs` already uses. This avoids backward-compatibility risk and keeps `sync.mjs` purpose-coherent.

2. **Keep it in `machinen.mjs`.** The project is currently a single-file CLI. Draft A introduces a new `cmd-sync.mjs` module. Draft B argues that a ~150-line command implementation does not justify a new file in a project that puts everything in one place. Inline helpers and a top-level `cmdSync` function follow the exact pattern used by every other command in the file.

3. **Project-local status file.** Draft A uses `~/.local/share/machinen/<container>/sync-status.json` (XDG). Draft B uses `.machinen/sync-status.json` relative to the git repo root (falling back to `$HOME/.machinen/<container>/sync-status.json` when not in a git repo). The status file travels with the project, is visible in the working directory, and is trivially accessible to the developer and to `restore` without path construction involving the user's home directory.

4. **Exponential backoff on failure, not hard exit.** Draft A exits after 3 consecutive auth failures. Draft B argues this is too aggressive — a transient network hiccup or a brief token issue should not kill the daemon entirely. Instead, failures use exponential backoff (doubling from 60 s up to a cap of 15 min). Auth errors specifically emit a prominent warning directing the user to re-authenticate. The daemon only exits if the container disappears — there is no point syncing a container that no longer exists.

5. **No `--remote` flag.** The sync daemon's responsibility is pushing to the registry. Pre-pulling on a remote server is a separate concern (it requires knowing a server IP in advance, which is not always available). Coupling pre-pull to the daemon conflates two responsibilities. `restore --remote` already handles the remote pull path.

---

## Relevant Learnings & Decisions

### Codebase artifacts consulted

**`src/sync.mjs`**
Exports `startBackgroundSync(containerName, registry, ip)`. Key observations:
- 30-second initial delay (`setTimeout(sync, 30 * 1000)`) — designed for the `cmdUp` "let user get settled" flow, not user-facing daemon UX.
- `stop()` sets `running = false` and clears the timer but does **not** await an in-progress sync. This is a silent correctness issue for a user-facing command.
- No callback surface for observing sync outcomes.
- `syncNow()` exists but is tied to internal state — not safe to call from outside without understanding the guard semantics.
- The function calls `createCheckpoint`, `buildCheckpointImage`, `pushImage`, etc. — all of these are already exported from `docker.mjs`.

**Conclusion:** The cleanest path is to call `docker.mjs` primitives directly rather than extend `sync.mjs` into something it was not designed to be.

**`src/docker.mjs`**
Exports `createCheckpoint`, `extractCheckpointFiles`, `buildCheckpointImage`, `pushImage` — the exact primitives used by the sync loop body in `sync.mjs`. These are stable and already used by `cmdFreeze` in `machinen.mjs`.

**`src/registry.mjs`**
`getRegistry()` caches result in module-level `_cached`. Safe to call once at startup. Auth failures throw with a message containing `write:packages` — parseable for auth-error detection.

**`src/machinen.mjs`**
Flat `parseArgs` function; all commands are functions in the same file. `currentContainerName()` and `currentBranch()` are already available as module-scope helpers. The pattern to verify container existence is `docker inspect --format '{{.State.Status}}'`.

### Decision log

| Open question | Decision | Rationale |
|---|---|---|
| Refactor `src/sync.mjs` | No — use `docker.mjs` primitives directly | Avoids retrofitting a purpose-built function; primitives are already stable and exported |
| Separate module vs inline | Inline into `machinen.mjs` | Consistent with existing architecture; command is small enough |
| Status file location | `.machinen/sync-status.json` in git repo root | Travels with project; visible to developer; no XDG path construction |
| Error recovery | Exponential backoff, exit only on container-gone | 3-strikes-exit is too aggressive for a daemon that should survive brief token issues |
| `--remote` flag | Omit | Pre-pull is restore's concern; daemon should do one thing |
| `--registry` override | Omit | `getRegistry()` is authoritative |
| Interval minimum | 30 seconds | Sub-30s checkpoint creation would thrash Docker and is rarely useful |

---

## Implementation Breakdown

### [MODIFY] `src/machinen.mjs`

All changes are in this single file.

**New helper functions (module scope):**

```js
function syncStatusPath(containerName)
function writeSyncStatus(statusPath, data)
function isAuthError(err)
```

**New command function:**

```js
async function cmdSync(args)
```

Responsibilities:
1. Parse and validate `--interval`, `--once` flags
2. Validate auth via `getRegistry()` at startup
3. Resolve container name (explicit arg → verify via Docker; no arg → auto-detect from git branch)
4. Locate status file path via `syncStatusPath(containerName)` — `<gitRoot>/.machinen/sync-status.json` or fallback
5. Run sync loop: `createCheckpoint` → `extractCheckpointFiles` → `buildCheckpointImage` + `pushImage` sequence (same as existing `cmdFreeze` body, but non-destructive checkpoint with `{ exit: false }`)
6. Maintain status file after each attempt
7. On failure: exponential backoff; on container-gone: exit 1; on auth error: warn prominently, back off
8. Handle SIGINT/SIGTERM: set shutdown flag, await any in-flight sync, write final status, exit 0
9. `--once`: run one sync, exit 0 or 1

**Wire into CLI:**
- Add `sync: cmdSync` to the `commands` object
- Add `sync` section to the help text

**Stale-status warning in `cmdRestore`:**
- Before pulling, check if `.machinen/sync-status.json` exists
- If it exists and `lastSync` is older than 10 minutes, print a warning with the elapsed time
- Check if the PID in the file is still alive (`kill(pid, 0)`) — if not, note that the daemon is not running
- `restore` proceeds regardless

### [NO CHANGE] `src/sync.mjs`

The existing `startBackgroundSync` function is left untouched. It continues to serve the `cmdUp` sleep/wake use case.

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

  Scenario: no container name, devcontainer auto-detected
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

  Scenario: --once runs exactly one sync and exits (E2E)
    Given a container "my-dev" is running and registry auth is valid
    When the user runs `machinen sync my-dev --once`
    Then exactly one sync is performed
    And the process exits 0 after completion

  # ── Status file ───────────────────────────────────────────────────────────────

  Scenario: status file written in git repo root (E2E)
    Given the user is in a git repo
    And a sync completes successfully
    Then `.machinen/sync-status.json` exists at the git repo root
    And it contains: pid, container, registry, lastSync (ISO), lastSyncSuccess (bool), syncCount (int), consecutiveFailures (int)

  Scenario: status file written in home fallback when not in git repo (E2E)
    Given the user is not in a git repo
    And a sync completes successfully
    Then `~/.machinen/<container>/sync-status.json` exists

  Scenario: status file updated after each sync (E2E)
    Given two syncs have completed
    Then `syncCount` equals 2
    And `lastSync` reflects the second sync time

  Scenario: status file persists after daemon exits (E2E)
    Given the daemon has synced at least once
    When the daemon is sent SIGTERM
    Then the status file still exists on disk after the process exits

  # ── Output format ─────────────────────────────────────────────────────────────

  Scenario: log lines use ISO timestamp format
    Given a sync daemon is running
    When any log line is emitted
    Then it matches `[ISO-timestamp] [LEVEL] message`

  Scenario: successful sync emits completion line
    Given a successful sync completes
    Then stdout contains "[INFO] Sync complete."

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

  # ── Error recovery ────────────────────────────────────────────────────────────

  Scenario: daemon backs off after transient sync failure (E2E)
    Given a sync fails due to a network error
    Then the daemon logs the error
    And schedules the next sync with exponential backoff (starting at 60 s)
    And does not exit

  Scenario: backoff resets after successful sync (E2E)
    Given the daemon has backed off due to a failure
    When the next sync succeeds
    Then the interval returns to the configured value

  Scenario: auth error produces prominent warning (E2E)
    Given a sync fails with an authentication error
    Then stderr contains a message directing the user to run `gh auth refresh`
    And the daemon does not exit

  Scenario: daemon exits when container disappears (E2E)
    Given the container is stopped externally during a sync session
    When the sync loop detects the container is gone
    Then the daemon exits 1 with a message about the container

  # ── restore integration ───────────────────────────────────────────────────────

  Scenario: restore uses registry without requiring daemon (E2E)
    Given the sync daemon has pushed at least one image
    And the daemon has been stopped
    When the user runs `machinen restore`
    Then it succeeds using the last pushed image

  Scenario: restore shows sync status from status file (E2E)
    Given `.machinen/sync-status.json` exists with a recent lastSync
    When the user runs `machinen restore`
    Then stdout contains when the last sync occurred

  Scenario: restore warns on stale status file (E2E)
    Given `.machinen/sync-status.json` has a `lastSync` older than 10 minutes
    When the user runs `machinen restore`
    Then stdout or stderr contains a stale warning
    And restore proceeds regardless

  Scenario: restore notes when sync daemon is not running (E2E)
    Given `.machinen/sync-status.json` exists
    And the PID in the file is not a running process
    When the user runs `machinen restore`
    Then stdout notes that the sync daemon is not currently running
```

---

## Types & Data Structures

### Status file: `.machinen/sync-status.json` (or `~/.machinen/<container>/sync-status.json`)

```ts
interface SyncStatus {
  pid: number;                    // PID of the running daemon (stale after exit)
  container: string;              // Container name
  registry: string;               // Registry prefix (e.g. ghcr.io/user)
  lastSync: string | null;        // ISO 8601 UTC timestamp of last sync attempt
  lastSyncSuccess: boolean | null; // null until first attempt completes
  syncCount: number;              // Total successful syncs in this session
  consecutiveFailures: number;    // Current run of consecutive failures (reset on success)
  currentIntervalMs: number;      // Effective interval (after backoff adjustments)
}
```

No `version` field. The status file is a human-readable diagnostic artifact, not a versioned protocol. If the schema changes, `restore` reads what it finds and gracefully handles missing fields.

The file is written atomically (write to `.tmp`, then `fs.renameSync`) to avoid torn reads.

### Exponential backoff (in-memory)

```js
const BASE_BACKOFF_MS = 60 * 1000;    // 60 s
const MAX_BACKOFF_MS = 15 * 60 * 1000; // 15 min
let currentBackoffMs = 0;              // 0 = use configured interval

function nextIntervalMs(configuredMs, consecutiveFailures) {
  if (consecutiveFailures === 0) return configuredMs;
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
}
```

### Container-gone detection

After each failed sync, check if the container still exists:

```js
function containerExists(name) {
  try {
    execSync(`docker inspect --format '{{.State.Status}}' ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
```

If the container is gone, log the reason and exit 1 rather than continuing to backoff indefinitely.

---

## Invariants & Constraints

1. **Resolution before loop:** Container must be verified to exist before the sync loop starts.
2. **Interval minimum:** `--interval` must be ≥ 30 seconds. Values below this exit 1 before any sync.
3. **Immediate first sync:** First sync fires immediately (no 30-second delay).
4. **Concurrency guard:** If a sync is still running when the next interval fires, skip it and log `[WARN] Previous sync still in progress, skipping`.
5. **Auth checked at startup only.** The module-level cache in `registry.mjs` is cleared on auth error (by catching and re-throwing without caching) — but in practice the daemon validates once at startup and relies on backoff + user-visible warnings for mid-session auth failures.
6. **Status file never deleted.** Persists after daemon exit. Written atomically.
7. **Backoff does not affect configured interval.** After a successful sync, the interval resets to the user-specified value, not the backoff value.
8. **`--once` behavior.** Run exactly one sync. Exit 0 on success, exit 1 on failure. No loop, no backoff, no signal handling needed.
9. **SIGINT/SIGTERM:** Set shutdown flag. If idle, exit 0 immediately. If sync in progress, wait for it to finish, write final status, exit 0.
10. **`src/sync.mjs` is not modified.** Existing callers (`cmdUp`) continue to work exactly as before.
11. **Container-gone exits.** If the container disappears during a session, the daemon exits 1 rather than looping forever.

---

## Tasks

- [ ] **T1:** Add `syncStatusPath(containerName)` helper to `machinen.mjs` — git root detection with home fallback, ensures directory exists
- [ ] **T2:** Add `writeSyncStatus(statusPath, data)` helper — atomic write via `.tmp` + rename
- [ ] **T3:** Add `isAuthError(err)` helper — regex against error message
- [ ] **T4:** Add `containerExists(name)` helper — wraps `docker inspect`, returns bool
- [ ] **T5:** Implement `cmdSync(args)` in `machinen.mjs` — arg parsing, validation, auth check, container resolution, sync loop with backoff, signal handling, status file writes
- [ ] **T6:** Wire `sync: cmdSync` into `commands` object and help text in `machinen.mjs`
- [ ] **T7:** Implement stale-status + PID-liveness check in `cmdRestore` in `machinen.mjs`
- [ ] **T8:** Run existing test suite; fix any regressions
- [ ] **T9:** Verify tests in `src/__tests__/sync-daemon.test.mjs` pass

---

## Open Questions (Resolved)

| Question | Decision |
|---|---|
| Where does `.machinen/` go in `.gitignore`? | The sync-status file is machine-local state. Add `.machinen/` to `.gitignore` in T1 (or document it). Optionally, treat it like `.git/` and leave it untracked by default. |
| What if two daemon instances run for the same container? | Last writer wins on the status file. The PID field lets `restore` detect if the earlier daemon is still running. No lock file — the daemon is user-invoked, and the UX is simple enough that two instances is a user error, not a race condition to defend against. |
| `registry.mjs` caches `_cached` — what happens when auth expires? | The cache is module-scoped and lives as long as the process. If the token expires mid-session, the sync will fail with an auth error. The daemon will log the auth warning, back off, and the user can `gh auth refresh` and let the next sync attempt succeed. Clearing the cache on auth error would require either patching `registry.mjs` (avoided by this RFC) or catching the error and re-calling `getRegistry()` — which would just fail again with the same cached result. Backoff + user warning is the correct response. |
