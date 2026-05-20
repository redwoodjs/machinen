# Nested continuation translation proof

Issue #420 moves from global/heap state to a controlled stack continuation.

The source is still the controlled C corpus, but the verifier now stops it while a nested function owns a live stack-local continuation frame. The capturer reads only that described frame object for decoding. The portable bundle records semantic live values and a logical continuation id; it does not copy the source stack bytes into `memory.bin`.

## Flow

1. Build the controlled corpus and raw capturer on Linux.
2. Launch the target with `--fixture continuation --pause-at-observation`.
3. The nested function `controlled_continuation_point` creates a stack-local `ControlledContinuationFrame` with:
   - `seed`
   - `live_local`
   - `resume_delta`
   - `checksum`
   - `continuation`
4. The exported `machinen_controlled_continuation_anchor` points at that live frame while the process is stopped.
5. The raw capturer follows that pointer and reads only the described frame object, not an arbitrary stack window.
6. The verifier decodes the required live values, validates the checksum, and emits `continuation.json` plus a portable bundle with an empty `memory.bin`.
7. Restore calls `--restore-continuation-bundle`, which enters `machinen_controlled_continuation_restore`, rebuilds a target-side frame, and resumes the logical continuation.

## Refusal path

If a required live value is not present in the continuation metadata, the proof refuses with:

```json
{
  "code": "continuation-live-value-missing",
  "message": "required continuation live values could not be found"
}
```

The verifier exercises this by removing `live_local` from the frame metadata and asserting the refusal happens before restore.

## Scope

This is still a controlled proof. The anchor makes the safe point explicit so we can prove the translation model before handling arbitrary optimized frames. The important property is the bundle shape: restore uses semantic live values and a logical continuation id, not raw return addresses or copied source stack bytes.

## Verify

Run on Linux:

```sh
pnpm continuation-translate
```

On non-Linux hosts the verifier skips because capture depends on Linux `/proc` and `ptrace`.
