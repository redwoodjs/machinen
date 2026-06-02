# Native regular-file FD bidirectional proof

Status: `verified-resource-seed`

This proof is the first resource row on the path toward a scoped selected-native
process claim. It verifies a regular file descriptor in both architecture
directions:

- `arm64 -> amd64`
- `amd64 -> arm64`

For each direction it retains:

- source capture descriptor with fd number, path, inode identity, offset, and flags
- target reconstruction plan using `reopen-file`
- target verifier output proving read starts at the captured offset, write follows
  the read, file identity matches the recorded policy, and no shortcut was used

This is only a resource reconstruction seed. It does **not** claim arbitrary
Linux process restore, raw CPU continuation, source-ISA emulation, runtime
profiles, sidecars, app hooks, or metadata-only success.

Run:

```sh
bash scripts/smoke/native-regular-file-fd-bidirectional-proof.sh
```

Retained report:

- `proofs/native-process-substrate/regular-file-fd-bidirectional/retained/native-regular-file-fd-bidirectional-proof-report.json`
