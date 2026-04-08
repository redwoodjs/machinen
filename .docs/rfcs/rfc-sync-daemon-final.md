# RFC: `machinen watch` — Standalone Checkpoint Sync Daemon

**Status:** Final (revised from Draft B per arbitration)
**Date:** 2026-03-23

---

## 2000ft View Narrative

`machinen restore` is only useful right after a freeze. If you want to restore hours later, you have to freeze again — which stops your container and takes significant time. The solution is a long-lived process that keeps the registry current while the container is running.

`machinen watch [container-name]` is that process. It runs in the foreground, periodically pushing the container's checkpoint to ghcr.io so that `restore` can always pull the latest image immediately.

**Where this RFC diverges from Draft A:**

1. **Don't refactor `src/sync.mjs`.** That module was designed for the sleep/wake handoff in `cmdUp` — it has a 30-second "let user get settled" delay, no callback surface, and its `stop()` doesn't wait for in-flight work. Rather than retrofitting it with an `opts` parameter, this RFC implements the sync loop directly in the command using the lower-level `docker.mjs` primitives that `src/sync.mjs` already uses internally. This avoids backward-compatibility risk and keeps `sync.mjs` purpose-coherent.

2. **Keep it in `machinen.mjs`.** The project is currently a single-file CLI. A ~150-line command implementation does not justify a new file in a project that puts everything in one place. Inline helpers and a top-level `cmdSync` function follow the exact pattern used by every other command in the file.

3. **Project-local status file.** Uses `.machinen/sync-status.json` relative to the git repo root (falling back to `$HOME/.machinen/<container>/sync-status.json` when not in a git repo). The status file travels with the project, is visible in the working directory, and is trivially accessible to the developer and to `restore` without path construction involving the user's home directory.

4. **Exponential backoff on failure, not hard exit.** Transient failures use exponential backoff (doubling from 60 s up to a cap of 15 min). Auth errors specifically emit a prominent warning directing the user to re-authenticate. The daemon only exits if the container disappears — there is no point syncing a container that no longer exists.

5. **No `--remote` flag.** The sync daemon's responsibility is pushing to the registry. Pre-pulling on a remote server is `restore`'s concern, not the daemon's. The daemon should not need to know a remote server IP in advance. `restore --remote` already handles that path.

---

## Decision Log

This section documents the four major architectural choices explicitly, with rationale that goes beyond the decision table.

### 1. Why `src/sync.mjs` was NOT refactored

`src/sync.mjs` exports `startBackgroundSync(containerName, registry, ip)`. This function was designed specifically for the `cmdUp` sleep/wake handoff:

- It has a hard-coded 30-second initial delay (`setTimeout(sync, 30 * 1000)`) described in comments as "let user get settled" — this delay is an artifact of the `cmdUp` flow where the user's terminal has just connected.
- `stop()` sets `running = false` and clears the timer but does **not** await any in-flight sync — acceptable for internal lifecycle management but a correctness hazard for a user-facing daemon that needs clean shutdown.
- There is no callback surface to observe sync outcomes.
- `syncNow()` is tied to internal state in ways that are not safe to call from the outside.

The `docker.mjs` primitives that `sync.mjs` calls (`createCheckpoint`, `extractCheckpointFiles`, `buildCheckpointImage`, `pushImage`) are all already exported and stable. The daemon calls them directly. This gives full control over the sync loop semantics (immediate first sync, proper in-flight tracking, clean backoff) without the risk of breaking `cmdUp`'s behavior by altering a shared module.

**Decision:** Use `docker.mjs` primitives directly. Do not modify `sync.mjs`.

### 2. Why exponential backoff was chosen over hard exit

Draft A exits after 3 consecutive auth failures. This is too aggressive for a daemon that the user runs as a background process and may not be watching.

Common causes of sync failures are transient: a brief network partition, a registry API hiccup, a token that has just expired (GH tokens are short-lived). If three syncs in a row hit the same 30-second outage, the daemon dies silently. The user only discovers this when they try to restore and find a stale image.

Exponential backoff (60 s → 120 s → 240 s → … → 900 s cap) lets the daemon ride out outages while self-throttling. When a sync succeeds, the interval resets to the user's configured value. The daemon only exits on `container-gone`, which is the one case where continuing is genuinely pointless.

Auth errors get a prominent stderr warning directing the user to run `gh auth refresh`. This is surface-visible without killing the daemon.

**Decision:** Exponential backoff with container-gone exit. Auth errors warn and back off; they do not terminate.

### 3. Why project-local `.machinen/sync-status.json` was chosen over XDG path

The XDG path (`~/.local/share/machinen/<container>/sync-status.json`) requires the reader to:

1. Know the container name in advance.
2. Construct a path involving `$HOME` and a sub-directory the user has never seen.
3. Know to look there when debugging.

The project-local path (`.machinen/sync-status.json` at the git root) is visible in the working directory, accessible with a relative path, and travels with the repo. When a developer asks "is my sync daemon healthy?" they can `cat .machinen/sync-status.json` without any path construction.

The file is added to `.gitignore` (it's machine-local state), and the fallback to `~/.machinen/<container>/sync-status.json` handles the edge case where the user is not in a git repo.

**Decision:** `.machinen/sync-status.json` at git root, with `~/.machinen/<container>/` fallback.

### 4. Why the `--remote` flag was excluded

Draft A includes `--remote <ip>` to let the daemon pre-pull images onto a remote server after each push. This conflates two responsibilities:

- **Daemon:** "Keep the registry current." The daemon does not need to know who will consume the image or where.
- **restore:** "Pull the latest image onto a target server." This is already handled by `machinen restore --remote`.

Adding `--remote` to the daemon also creates a coupling problem: the daemon must know the remote server IP at startup, long before the user may know where they want to restore. If the server changes, the daemon must be restarted. The whole point of the daemon is to decouple "when to push" from "when to restore."

**Decision:** No `--remote` flag. The daemon pushes; `restore` pulls.

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

### Decision summary table

| Open question             | Decision                                         | Rationale                                                                                |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Refactor `src/sync.mjs`   | No — use `docker.mjs` primitives directly        | Avoids retrofitting a purpose-built function; primitives are already stable and exported |
| Separate module vs inline | Inline into `machinen.mjs`                       | Consistent with existing architecture; command is small enough                           |
| Status file location      | `.machinen/sync-status.json` in git repo root    | Travels with project; visible to developer; no XDG path construction                     |
| Error recovery            | Exponential backoff, exit only on container-gone | 3-strikes-exit is too aggressive for a daemon that should survive brief token issues     |
| `--remote` flag           | Omit                                             | Pre-pull is restore's concern; daemon should do one thing                                |
| `--registry` override     | Omit                                             | `getRegistry()` is authoritative                                                         |
| Interval minimum          | 30 seconds                                       | Sub-30s checkpoint creation would thrash Docker and is rarely useful                     |

---

## Implementation Breakdown

### [MODIFY] `src/machinen.mjs`

All changes are in this single file.

**New helper functions (module scope):**

```js
function syncStatusPath(containerName)
function writeSyncStatus(statusPath, data)
function isAuthError(err)
function containerExists(name)
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
6. Maintain status file after each attempt (including `consecutiveFailures` count)
7. On failure: exponential backoff; on container-gone: exit 1; on auth error: warn prominently, back off
8. Handle SIGINT/SIGTERM: set shutdown flag, await any in-flight sync, write final status, exit 0
9. `--once`: run one sync, exit 0 or 1

**Wire into CLI:**

- Add `watch: cmdSync` to the `commands` object
- Add `watch` section to the help text

**Stale-status warning in `cmdRestore`:**

- Before pulling, check if `.machinen/sync-status.json` exists
- If it exists, print when the last sync occurred
- If `lastSync` is older than 10 minutes, print a stale warning with the elapsed time
- Check if the PID in the file is still alive (`kill(pid, 0)`) — if not, note that the daemon is not running
- `restore` proceeds regardless

### [NO CHANGE] `src/sync.mjs`

The existing `startBackgroundSync` function is left untouched. It continues to serve the `cmdUp` sleep/wake use case.

---

## Behavior Spec

```gherkin
Feature: machinen watch daemon

  # ── CLI Surface ──────────────────────────────────────────────────────────────

  Scenario: watch appears in top-level help
    When the user runs `machinen` with no arguments
    Then stdout contains "watch"

  Scenario: watch --help shows usage
    When the user runs `machinen watch --help`
    Then output contains "watch", "interval", and "--once"
    And the process exits 0

  # ── Container resolution ─────────────────────────────────────────────────────

  Scenario: no container, not in git repo
    Given the user is not in a git repository
    And no container name is passed
    When the user runs `machinen watch`
    Then stderr contains "container"
    And the process exits 1

  Scenario: explicit container does not exist
    Given the container "nonexistent_xyz" is not running in Docker
    When the user runs `machinen watch nonexistent_xyz`
    Then the process exits 1

  Scenario: explicit container exists
    Given the container "my-dev" is running in Docker
    When the user runs `machinen watch my-dev`
    Then the daemon starts and logs "my-dev" in the startup message

  Scenario: no container name, devcontainer auto-detected
    Given the user is in a git repo on branch "main"
    And a container named "machinen-main" is running
    When the user runs `machinen watch`
    Then the daemon uses container "machinen-main"

  # ── Interval validation ───────────────────────────────────────────────────────

  Scenario: non-numeric interval
    When the user runs `machinen watch --interval abc`
    Then the process exits 1

  Scenario: zero interval
    When the user runs `machinen watch --interval 0`
    Then the process exits 1

  Scenario: interval below minimum (< 30)
    When the user runs `machinen watch --interval 10`
    Then the process exits 1
    And output matches /interval.*minimum|minimum.*interval/i

  Scenario: valid interval passes validation
    When the user runs `machinen watch --interval 60` with no resolvable container
    Then the process exits 1 for a container reason, NOT an interval reason

  Scenario: interval from environment variable
    Given MACHINEN_SYNC_INTERVAL=120 is set
    When the user runs `machinen watch`
    Then the daemon uses a 120-second interval

  # ── Startup behavior ──────────────────────────────────────────────────────────

  Scenario: daemon logs configuration on startup
    Given a container "my-dev" is running
    When the user runs `machinen watch my-dev --interval 60`
    Then stdout contains the container name, registry URL, and interval before the first sync

  Scenario: first sync is immediate
    Given a container "my-dev" is running
    When the user runs `machinen watch my-dev`
    Then a sync attempt begins within 1 second of startup (not after a 30s delay)

  # ── --once flag ───────────────────────────────────────────────────────────────

  Scenario: --once with no container exits without hanging
    Given no container is resolvable
    When the user runs `machinen watch --once`
    Then the process exits without being signaled (not a hang)

  Scenario: --once with invalid interval rejected
    When the user runs `machinen watch --once --interval xyz`
    Then the process exits 1

  Scenario: --once runs exactly one sync and exits (E2E)
    Given a container "my-dev" is running and registry auth is valid
    When the user runs `machinen watch my-dev --once`
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
    And consecutiveFailures resets to 0 in the status file

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
  pid: number; // PID of the running daemon (stale after exit)
  container: string; // Container name
  registry: string; // Registry prefix (e.g. ghcr.io/user)
  lastSync: string | null; // ISO 8601 UTC timestamp of last sync attempt
  lastSyncSuccess: boolean | null; // null until first attempt completes
  syncCount: number; // Total successful syncs in this session
  consecutiveFailures: number; // Current run of consecutive failures (reset to 0 on any success)
  currentIntervalMs: number; // Effective interval after backoff adjustments (equals configured interval when not in backoff)
}
```

No `version` field. The status file is a human-readable diagnostic artifact, not a versioned protocol. If the schema changes, `restore` reads what it finds and gracefully handles missing fields.

The `consecutiveFailures` field is the primary signal for external observability into the backoff state. A value of 0 means the last sync succeeded (or no sync has run yet). A non-zero value means the daemon is currently in backoff and the effective interval is longer than the configured interval. This is surfaced in the status file so that tooling and users can detect degraded sync health without reading daemon logs.

The file is written atomically (write to `.tmp`, then `fs.renameSync`) to avoid torn reads.

### Exponential backoff (in-memory)

```js
const BASE_BACKOFF_MS = 60 * 1000; // 60 s
const MAX_BACKOFF_MS = 15 * 60 * 1000; // 15 min

function nextIntervalMs(configuredMs, consecutiveFailures) {
  if (consecutiveFailures === 0) return configuredMs;
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
}
```

After a successful sync, `consecutiveFailures` resets to 0 and `nextIntervalMs` returns `configuredMs`. The backoff does not bleed across sessions.

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
7. **Backoff does not affect configured interval.** After a successful sync, the interval resets to the user-specified value, not the backoff value. `consecutiveFailures` resets to 0.
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
- [ ] **T6:** Wire `watch: cmdSync` into `commands` object and help text in `machinen.mjs`
- [ ] **T7:** Implement stale-status + PID-liveness check in `cmdRestore` in `machinen.mjs`
- [ ] **T8:** Run existing test suite; fix any regressions
- [ ] **T9:** Verify tests in `src/__tests__/sync-daemon.test.mjs` pass

---

## Open Questions (Resolved)

| Question                                                          | Decision                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does `.machinen/` go in `.gitignore`?                       | The sync-status file is machine-local state. Add `.machinen/` to `.gitignore` in T1 (or document it).                                                                                                                                                                                                           |
| What if two daemon instances run for the same container?          | Last writer wins on the status file. The PID field lets `restore` detect if the earlier daemon is still running. No lock file — the daemon is user-invoked, and the UX is simple enough that two instances is a user error, not a race condition to defend against.                                             |
| `registry.mjs` caches `_cached` — what happens when auth expires? | The cache is module-scoped and lives as long as the process. If the token expires mid-session, the sync will fail with an auth error. The daemon will log the auth warning, back off, and the user can `gh auth refresh` and let the next sync attempt succeed. Backoff + user warning is the correct response. |
