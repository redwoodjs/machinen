# Raw process capture proof

Issue #416 adds the first external capture step for the controlled binary corpus.

The target is still a binary we control, but it does **not** call `machinen_checkpoint` and does **not** write a portable bundle. The external capturer launches the target with `--pause-at-observation`, waits for the target to stop itself with `SIGSTOP`, and then captures process state from the outside.

## Captured state

The Linux capturer writes an inspectable directory with:

- `manifest.json` — pid, target argv, stop signal, and host architecture.
- `threads.json` — thread ids and raw `NT_PRSTATUS` register bytes from `ptrace`.
- `maps.json` — parsed `/proc/<pid>/maps` entries.
- `fds.json` — `/proc/<pid>/fd` targets.
- `symbols.json` — exported symbol addresses passed in by the verifier.
- `memory.json` and `memory.bin` — raw bytes read from `/proc/<pid>/mem` for those symbols.
- Optional followed-list chunks — when a verifier supplies a DWARF-derived `--follow-list`, the capturer reads a root pointer/count pair and captures the pointed-to heap nodes by a generic node size and next-pointer offset.
- Optional followed-pointer chunks — when a verifier supplies `--follow-pointer`, the capturer reads one pointer field from a root symbol and captures only that described object. The continuation proof uses this to decode a live stack-local frame without copying a raw stack window.
- `target.log` — the controlled fixture's observation marker and pause log.

## Verify

Run on Linux:

```sh
pnpm raw-process-capture
```

The verifier builds the controlled corpus as a non-PIE Linux binary, scans its exported symbols with `nm`, and runs three captures:

1. `global` — recovers scalar global state from raw memory.
2. `resource` — captures a live regular-file descriptor.
3. `threads` — captures the main thread plus two worker threads and recovers their semantic state from raw memory.

On non-Linux hosts, the verifier skips because it depends on Linux `/proc` and `ptrace`.
