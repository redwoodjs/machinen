# Known-symbol semantic extraction proof

Issue #417 is the first step from raw capture toward portable state translation.

The source process still does not call `machinen_checkpoint` and does not write a bundle. Instead, the verifier uses a normal exported symbol, `machinen_controlled_heap_state`, plus the known C layout of `struct ControlledHeapState` and `struct ControlledNode`.

## Flow

1. Build the controlled corpus and raw capturer on Linux.
2. Launch the controlled corpus heap fixture with `--pause-at-observation`.
3. Capture `machinen_controlled_heap_state` from `/proc/<pid>/mem`.
4. Read the `head` pointer from that captured struct.
5. Follow each `struct ControlledNode.next` pointer in the stopped process.
6. Emit a portable bundle with:
   - `manifest.json`
   - `objects.json`
   - `relocations.json`
   - `resources.json`
   - `memory.bin`
7. Start a matching target-architecture controlled binary and restore the extracted semantic heap graph.

The target restore path reads `controlled-state.txt`, an intentionally small sidecar inside the proof bundle. The standard portable files are still emitted and validated by tests. Later issues can replace the proof sidecar with a real restore loader that consumes only the portable bundle documents.

## Verify

Run on Linux:

```sh
pnpm known-symbol-extract
```

On non-Linux hosts the verifier skips, because the capture path depends on Linux `/proc` and `ptrace`.
