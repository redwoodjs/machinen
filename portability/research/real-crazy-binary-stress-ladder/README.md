# Real crazy binary stress ladder

This lane stress-tests a broad set of real native binaries while keeping the
claim boundary narrow.

Accepted rows:

- `vi`/`vim` scripted edit and save through a controlled pty
- `nano` scripted edit and save through a controlled pty
- `python3 -i` semantic REPL state and expression continuation
- `sqlite3` CLI table insert/query against a deterministic DB file
- `vi`/`vim` live unsaved-buffer safe point, then target-native save continuation
- `nano` live unsaved-buffer safe point, then target-native save continuation
- `python3 -i` live primary-prompt safe point, then target-native expression continuation
- `sqlite3` live prompt after durable writes, then target-native query continuation
- `curl` completed request against a controlled local HTTP server
- `make` tiny deterministic target
- `make` live controlled recipe gate, then target-native remaining work
- `top` rendered TUI then quit
- `top` live rendered-frame safe point, then target-native quit continuation
- `watch` rendered TUI then quit
- `watch` live rendered-frame safe point, then target-native quit continuation
- `tar` archive/extract deterministic tree
- `find` deterministic tree walk
- `find` live controlled walk gate, then target-native stable traversal
- `rsync` local-to-local deterministic copy
- `openssl enc` deterministic encrypt/decrypt round trip

Refused rows:

- `curl` live TCP transfer with partial body
- `ssh` live crypto/socket/session boundary
- `strace` ptrace boundary
- `tar` live partial archive stream
- `rsync` live partial copy state
- `openssl enc` live cipher stream with partial input/output
- `openssl s_client` live TLS socket/session boundary
- `gdb` inferior/ptrace boundary

All accepted rows require same-architecture behavior plus bidirectional amd64 ↔
arm64 retained target-native descriptor/materialization evidence. The mid-edit,
REPL, sqlite, make, top, watch, and find rows additionally require a live source
safe point, a retained continuation descriptor from that source, and
target-native continuation from that descriptor. Refused rows
must refuse in same/source/target roles. This lane does not claim arbitrary
process restore, source-ISA emulation, raw VM replay, or raw stack/heap/register
reconstruction.

Run:

```sh
portability/research/real-crazy-binary-stress-ladder/verify.sh
```

The retained result is `proved-with-refusals` in `retained/report.json`.
