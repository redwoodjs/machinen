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

## Target libc/startup dependency inventory

The current process-context model is for an already-running target-native loader
that jumps into controlled target code. It can safely expose only state that the
loader owns or can verify after restore:

- environment variables through target `clearenv()`/`setenv()` and `getenv()`;
- cwd through target `chdir()` and `getcwd()`;
- bounded argv strings through a target-owned pointer block for verifier code;
- selected auxv values that are stable target facts (`AT_PAGESZ`, `AT_CLKTCK`).

It does not claim full libc start reconstruction. Target libc's original kernel
startup stack, dynamic-loader private globals, vDSO/vvar pointers, random bytes,
interpreter base, and executable-name pointer ownership remain target-owned or
refused unless a mode models them explicitly.

## Target-side consumption

Descriptors use `native=process-context` steps. Four modes are available:

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
- `apply-target-initial-stack` models a bounded target initial-stack block. It
  materializes real target pointers for each captured argv string, target envp
  entries, NULL terminators, and a selected-safe auxv array containing
  `AT_PAGESZ`, `AT_CLKTCK`, and `AT_NULL`. The target-native trampoline verifies
  the pointer layout and strings after materialization.

The initial-stack mode also records an explicit auxv materialization policy:
selected-safe entries are materialized, while target-variant/source-pointer
entries are listed as refused for this model rather than silently copied from the
source:

| Entry / mapping          | Current policy                            | Reason                                                                       |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `AT_PAGESZ`              | materialize selected target-visible value | stable target ABI value checked with target `getauxval()`                    |
| `AT_CLKTCK`              | materialize selected target-visible value | stable target ABI value checked with target `getauxval()`                    |
| `AT_RANDOM`              | refuse                                    | source pointer/random bytes are process-local target-owned state             |
| `AT_EXECFN`              | refuse                                    | source pointer names source execution context, not target-owned argv storage |
| `AT_BASE`                | refuse                                    | interpreter/load base is target dynamic-loader state                         |
| `AT_SYSINFO_EHDR` / vDSO | refuse                                    | vDSO pointer and code page are target-kernel supplied                        |
| vvar                     | refuse                                    | vvar data is target-kernel supplied and time-sensitive                       |

The visible mode refuses if the controlled env token, argv token, or selected
safe auxv entries are missing. Source-only and target-variant auxv entries stay
metadata-only unless a mode explicitly models them.

The trampoline reports `nativeProcessContextRestore.status=passed` only after it
consumes all process-context steps. The VM proof maps that to
`targetProcessContextRestoreResult=passed`, and failed markers block proof
completion.

Full libc process-start reconstruction remains outside this proof: the model
creates a verified target-native pointer block and target libc env/cwd state, but
it does not rewrite the already-running loader's original kernel-provided stack.
Unsupported state must continue to fail closed until modeled explicitly.
