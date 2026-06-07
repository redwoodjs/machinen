# Real less detector

This lane is the first detector-only step toward real `/usr/bin/less` research support.

It does not claim arbitrary raw `less` continuation yet. It detects selected real launched `less` states under a controlled pty and records fail-closed refusal cases.

Accepted detector states:

- `accepted-ready-outside-syscall`
- `accepted-blocked-pty-read`

The harness builds known upstream `less` 643 with debug symbols and two marker symbols:

- `machinen_less_ready_before_input_marker`
- `machinen_less_ready_before_input_gate`

The ready-outside-syscall row is accepted only for this marker build. The marker is inserted in the command loop after prompt/page rendering is flushed and before `getcc()` reads the next command byte.

Detector v2 accepts the blocked-read row only when `/proc/<pid>/syscall` proves `read(fd)`, the read fd targets the exact harness pty slave, fd `0/1/2` all target that same slave, session/process-group/foreground-pty ownership matches, and the pty input queue is empty on both harness and slave-side checks.

Refusal coverage includes wrong binary/version, missing regular file, pipe/stdin input, missing/non-empty pty, extra thread, socket fd, pending signal, process/session mismatch, terminal resize, unmodeled active syscall, missing safe-point evidence, source-ISA emulation, metadata-only success, dynamic-library mismatch, and unknown app-owned heap state. Wrong binary, pipe/stdin input, non-empty pty input, and socket-fd refusals are real process examples; harder cases remain synthetic in v2.

Run:

```sh
portability/research/real-less-detector/verify.sh
```

The script builds the marker less on `root@192.168.0.8`, runs the Python detector there, and copies retained captures back into `retained/`. The remote host needs the normal less build toolchain and terminal headers, including `gcc`, `make`, and `libncurses-dev`.
