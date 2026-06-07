# Real less marker/unmodified equivalence

This lane compares the known marker `less` build with unmodified system `/usr/bin/less` for the narrow blocked-read pager scenario.

It launches both under controlled ptys with the same file and rows/cols, verifies first-page output, strict blocked `read(fd)` pty facts, empty input queues, and same next-`SPACE` behavior. It does not claim source-level marker proof for the unmodified binary.

Run:

```sh
portability/research/real-less-marker-unmodified-equivalence/verify.sh
```
