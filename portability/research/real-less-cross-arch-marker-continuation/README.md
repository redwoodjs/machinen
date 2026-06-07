# Real less cross-architecture marker continuation

This lane is the first bidirectional cross-architecture continuation harness for real `less`.

It builds known debug/marker-symbol upstream `less` 643 on both hosts, then proves both directions:

- `amd64-to-arm64`
- `arm64-to-amd64`

For each direction, the harness:

1. launches source-native marker `less` under a controlled pty
2. uses `ptrace` to capture PC/SP/registers at `machinen_less_ready_before_input_marker`
3. records source maps, fds, pty, file, page, and screen descriptors
4. launches target-native marker `less` under a controlled pty
5. uses `ptrace` to prove the target reaches the matching marker safe point
6. materializes only descriptor state: same file content, same rows/cols, same first-page expectation, and pending `SPACE`
7. writes the target marker gate, detaches, injects `SPACE`, and verifies the next page appears

This is target-native continuation, not source-ISA emulation, raw VM replay, or arbitrary raw heap/stack/register restore. Source registers/stacks/heaps are captured as evidence, but are not written into the target process in this milestone.

Run:

```sh
portability/research/real-less-cross-arch-marker-continuation/verify.sh
```

Default hosts:

- amd64: `root@192.168.0.8`
- arm64: `friend@100.126.46.90`

Retained evidence is copied into `retained/`.
