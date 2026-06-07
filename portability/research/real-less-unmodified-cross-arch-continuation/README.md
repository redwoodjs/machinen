# Real less unmodified cross-arch continuation

This lane proves bidirectional descriptor continuation for unmodified system `/usr/bin/less` in the narrow blocked-read scenario.

It captures an unmodified source candidate on one architecture, launches target-native unmodified `less` on the other architecture with the same file/page/pty descriptors, injects `SPACE`, and verifies the next page. This uses no marker symbols, no source-ISA emulation, and no raw stack/heap/register writes.

Run:

```sh
portability/research/real-less-unmodified-cross-arch-continuation/verify.sh
```
