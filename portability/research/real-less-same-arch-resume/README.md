# Real less same-arch resume

This lane is the first continuation proof after the real `less` detector.

It builds the same known debug/marker-symbol upstream `less` 643 used by the detector lane, launches it under a controlled pty, attaches with `ptrace`, captures registers and process/resource facts at `machinen_less_ready_before_input_marker`, writes the marker gate so the process can leave the safe-point spin, detaches, injects `SPACE`, and verifies the next page appears.

This is same-architecture only on `x86_64` and does not claim cross-architecture restore yet.

Run:

```sh
portability/research/real-less-same-arch-resume/verify.sh
```

The script runs on `root@192.168.0.8`, uses `known_less_builder.py` from `../real-less-detector/`, and copies retained evidence back into `retained/`.
