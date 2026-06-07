# Real pager and watcher stateful ladder

This lane advances the pager/watcher ladder by adding state before capture and
resource events after capture.

It proves six increasing complexity groups:

1. Non-first-page pager state: `less` and `more` capture after `SPACE`, then `b`
   returns to the first page.
2. Search state: `less` and package-extracted `most` capture after a search,
   then `n` advances to the next retained match.
3. Wrapper/default pager behavior: `man printf` and `git log --paginate` use
   their default pager behavior and exit with `q`.
4. Real documentation: `man git-log` renders real installed documentation and
   exits with `q`.
5. Watcher resource complexity: `tail -f` handles truncation, `tail -F` handles
   rotation, and `tail -f` over multiple files emits an append from the second
   file.
6. Timer/signal process state: `sleep 30` is captured in `clock_nanosleep` and
   exits after a delivered signal.

All rows require same-architecture behavior plus bidirectional amd64 ↔ arm64
retained descriptor-continuation evidence. This is target-native descriptor
materialization only. It does not claim arbitrary process restore, source-ISA
emulation, raw VM replay, or raw stack/heap/register reconstruction.

Run:

```sh
portability/research/real-pager-and-watcher-stateful-ladder/verify.sh
```

The retained result is `all-present-accepted` in `retained/report.json`.
