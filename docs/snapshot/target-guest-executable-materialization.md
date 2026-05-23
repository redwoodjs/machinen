# Target guest executable materialization

Issue #659 plans target VM executable/shared-object mappings from target-native
artifacts.

`planTargetGuestExecutableMaterialization()` consumes executable
`map-target-file` mapping steps and emits `map-target-executable` steps with:

- target virtual range;
- target file path and offset;
- build-id or sha256 provenance;
- `sourceTextReusedAsTargetCode: false`.

Executable mappings that would copy captured source bytes refuse with
`mapping-executable-unsupported`. Executable mappings without target-file
build/hash provenance refuse with `mapping-provenance-ambiguous`. On target, the
amd64 trampoline now checks the native executable-mapping section against the
actual target code path, address, size, file offset, safe execute/private flags,
and build-id or sha256 provenance before reporting the mapping as consumed.
Non-executable private data is ignored here and handled by the private-memory
restore path.
