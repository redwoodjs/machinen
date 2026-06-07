# Real less unmodified safe-point inference

This lane classifies safe-point candidates for unmodified system `/usr/bin/less`.

It does not use marker symbols and does not claim support. It launches system `less` under a controlled pty, waits for first-page output, verifies the process is blocked in `read(fd)` on the exact controlled pty, checks fd/session/process-group/foreground-pty facts, proves the input queues are empty, then injects `SPACE` and verifies the next page appears.

The retained status is `classified-candidate`, not `accepted` or `supported-subset`, because output/syscall inference is not source-level safe-point proof.

Run:

```sh
portability/research/real-less-unmodified-safe-point-inference/verify.sh
```

Default host: `root@192.168.0.8`.
