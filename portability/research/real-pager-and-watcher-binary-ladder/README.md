# Real pager and watcher binary ladder

This lane expands from one real pager to a small binary ladder with increasing
resource and process complexity.

Adapters:

1. `more` — single binary pager over a regular file and controlled pty.
2. `pg` — alternate pager when installed. It is absent on the current amd64 and
   arm64 research hosts, so the retained row is `skipped-not-installed` and not
   supported.
3. `most` — alternate distro pager. If not installed, the harness downloads and
   extracts the target-native distro package in the temporary work directory.
4. `man printf` — wrapper process that renders a man page through a pager child.
5. `git log --paginate` — application plus generated repository plus pager
   child.
6. `tail -f` — non-pager watcher that emits new output after a file append.

The pager adapters model direct `read(fd)`, `poll`/`ppoll`, or `pselect6`
input-wait states with controlled pty I/O. The watcher adapter models a
deterministic regular-file append event. All supported rows require
same-architecture behavior plus bidirectional amd64 ↔ arm64 descriptor-continuation evidence.

This is target-native descriptor materialization only. It does not claim
arbitrary process restore, source-ISA emulation, raw VM replay, or raw
stack/heap/register reconstruction.

Run:

```sh
portability/research/real-pager-and-watcher-binary-ladder/verify.sh
```

The retained result is `all-present-accepted`: every present/provisioned binary
passed same-arch and bidirectional cross-arch checks. `pg` remains blocked only
because it is not installed/available on the retained hosts.
