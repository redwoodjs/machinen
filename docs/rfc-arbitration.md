# RFC Arbitration: `machinen sync` Daemon Command

**Date:** 2026-03-23
**Arbitrator:** Synthesizer
**Competing RFCs:** Draft A vs. Draft B
**Selected:** Draft B

---

## Summary

Both RFCs articulate a coherent vision for the `machinen sync` daemon. The core differences are architectural (module organization, error recovery strategy, status file location) rather than UX. **RFC Draft B is selected** because it makes more pragmatic tradeoffs: lower implementation risk, more resilient error recovery, and better alignment with existing codebase patterns.

---

## Decision Analysis

### 1. Error Recovery: Exponential Backoff vs. Hard Exit

| Dimension | Draft A | Draft B | Winner |
|-----------|---------|---------|--------|
| Strategy on auth failure | Exit after 3 consecutive failures | Exponential backoff + warn; exit only on container-gone | B |
| Resilience to transient issues | Low — any 3 consecutive auth failures kills the daemon | High — brief token issues are tolerated | B |
| User experience | Silent exit (user may not notice) | Prominent warnings, daemon continues | B |
| Observability | No in-memory state for backoff | `consecutiveFailures` field in status file visible to external tools | B |

**Rationale:** A long-lived daemon should survive brief transient failures. Network hiccups, token expiration, and registry flakiness are common. Hard exit is appropriate only for unrecoverable errors (e.g., container disappears). Draft B's exponential backoff with `container-gone` detection is the correct strategy.

### 2. `src/sync.mjs` Refactoring

| Dimension | Draft A | Draft B | Winner |
|-----------|---------|---------|--------|
| Change scope | Refactor `startBackgroundSync` with `opts`, callbacks | No changes to existing modules; use `docker.mjs` primitives directly | B |
| Risk to existing callers | `cmdUp` must be tested; new optional parameters must be backward-compatible | None — no changes to shipped code | B |
| Design justification | `sync.mjs` becomes general-purpose sync engine | Recognize `sync.mjs` was designed for internal sleep/wake handoff, not user-facing CLI | B |
| Primitives reused | Higher-level abstraction (extended `startBackgroundSync`) | Lower-level stable primitives already exported from `docker.mjs` | B |

**Rationale:** Retrofitting `src/sync.mjs` with an `opts` object and callbacks is over-engineering. The module was purpose-built for the `cmdUp` sleep/wake flow (30-second settle delay, internal lifecycle). Draft B correctly observes that `docker.mjs` primitives (`createCheckpoint`, `buildCheckpointImage`, `pushImage`) are already stable and exported. Call them directly. This avoids backward-compatibility risk and keeps `sync.mjs` coherent.

### 3. Status File Location

| Dimension | Draft A | Draft B | Winner |
|-----------|---------|---------|--------|
| Path | `~/.local/share/machinen/<container>/sync-status.json` | `.machinen/sync-status.json` (git repo root) with `~/.machinen/<container>/` fallback | B |
| Visibility | Hidden in XDG directory (requires path knowledge) | Visible in working directory, travels with project | B |
| Usefulness for developers | Low — path is not intuitive | High — discoverable, debuggable | B |
| Integration with `restore` | `restore` must construct XDG path to check staleness | `restore` checks repo root first (natural), then fallback | B |

**Rationale:** Project-local status is more discoverable and natural for a development tool. The `.machinen/` directory (added to `.gitignore`) is visible, follows naming conventions (dot-directories are standard for tool state), and travels with the repo. Fallback to `~/.machinen/<container>/` supports contexts where the repo root is not available.

### 4. `--remote` Flag

| Dimension | Draft A | Draft B | Winner |
|-----------|---------|---------|--------|
| Scope | Daemon pushes to registry AND pre-pulls on remote server | Daemon only pushes to registry | B |
| Responsibility | Conflates two concerns (push + pre-pull) | Separation: daemon pushes, `restore --remote` handles pre-pull | B |
| Use case | Convenience flag for the daemon | Belongs in `restore`, which knows the server IP | B |
| Coupling risk | Daemon must know remote server details in advance | Daemon is agnostic to how images are consumed | B |

**Rationale:** The daemon's single responsibility is "keep the registry current." How and where images are consumed is the domain of `restore`. Coupling pre-pull to the daemon requires advance knowledge of the server IP, which defeats the daemon's whole point (asynchronous, always-ready registry). `restore --remote` already handles remote pre-pull.

### 5. Status File Versioning

| Dimension | Draft A | Draft B | Winner |
|-----------|---------|---------|--------|
| Approach | `version: "1"` field in JSON | No version field; treat as diagnostic | B* |
| Rationale | Enable schema migrations | Schema changes can be handled gracefully without versioning | B |
| Complexity | Adds version negotiation logic | None — read what's available | B |

**Rationale:** Minimal edge to Draft B. The status file is a diagnostic artifact, not an API contract. If the schema needs to change, `restore` can gracefully handle its absence. Over-versioning adds complexity without clear benefit for a v1 feature.

### 6. Module Organization

| Dimension | Draft A | Draft B | Winner |
|-----------|---------|---------|--------|
| Location | New `src/cmd-sync.mjs` | Inline in `machinen.mjs` | B |
| Consistency | Introduces a new pattern (separate command modules) | Matches existing architecture (all commands in one file) | B |
| File count | +1 | No new files | B |
| Justification | "Keeps `machinen.mjs` from growing further" | ~150 lines does not justify breaking existing pattern | B |

**Rationale:** The project currently centralizes all commands in `machinen.mjs` with a flat `parseArgs` and a `commands` map. Introducing a separate `cmd-sync.mjs` module would break this pattern and establish precedent for future commands. A ~150-line implementation is not large enough to justify the inconsistency.

---

## Elements from Draft A to Incorporate

1. **Decision log format:** Draft A's explicit decision table should be adopted in Draft B's RFC revision. Clearly document *why* exponential backoff was chosen over hard exit, and *why* `src/sync.mjs` was not refactored.

2. **Comprehensive behavior spec scenarios:** Both RFCs have thorough specs. Ensure the final spec includes:
   - All startup validation scenarios (interval, container resolution)
   - All signal-handling scenarios (SIGINT/SIGTERM during idle and during sync)
   - All error-recovery scenarios (transient failures, container-gone, backoff resets)
   - Restore integration scenarios (stale detection, PID liveness check)

3. **`consecutiveFailures` in status file:** Draft B already includes this (not in Draft A's status schema). This is correct and should be emphasized in the final RFC.

---

## Verdict

RFC Draft B is **architecturally sound, pragmatically justified, and ready for revision and implementation.** No blockers. Proceed to Phase 5.
