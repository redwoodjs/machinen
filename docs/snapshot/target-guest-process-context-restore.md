# Target guest process-context restore

The native target-loader path now carries bounded argv/env/cwd/auxv process
context as an explicit native restore section.

## Scope

This is a narrow handoff proof, not a broad libc process-start reconstruction.
The planner accepts only captured process context that is present in both the
native-process manifest and resource table and is bounded:

- argv: non-empty, no NUL bytes, at most 128 entries;
- env: keys cannot be empty, contain `=`, or contain NUL bytes; values cannot
  contain NUL bytes; at most 256 entries;
- cwd: absolute bounded path;
- auxv: captured even-length hex bytes, at most 4096 bytes.

Malformed, missing, inconsistent, or oversized context refuses with
`target-process-context-unsupported`.

## Target-side consumption

Descriptors use `native=process-context` steps. Three modes are available:

- `metadata-only` records argv/env/cwd/auxv counts and SHA-256 digests for a
  target-native consumption gate.
- `apply-target-env-cwd` additionally clears the target environment, sets the
  captured env entries, verifies the env count, changes to the captured cwd, and
  verifies `getcwd()`.
- `apply-target-visible-context` keeps the env/cwd application above and adds a
  controlled target-visible proof: it materializes a bounded argv block for the
  `--machinen-argv-token` profile, verifies `getenv("MACHINEN_CONTEXT_TOKEN")`,
  verifies `getcwd()`, and compares selected safe auxv entries (`AT_PAGESZ`,
  `AT_CLKTCK`) with target `getauxval()`.

The visible mode refuses if the controlled env token, argv token, or selected
safe auxv entries are missing. Source-only and target-variant auxv entries stay
metadata-only; asking to materialize them remains unsupported.

The trampoline reports `nativeProcessContextRestore.status=passed` only after it
consumes all process-context steps. The VM proof maps that to
`targetProcessContextRestoreResult=passed`, and failed markers block proof
completion.

Full target initial-stack and libc process-start reconstruction, vDSO/vvar
dependencies, and general auxv semantics remain outside this proof and must
continue to fail closed until modeled explicitly.
