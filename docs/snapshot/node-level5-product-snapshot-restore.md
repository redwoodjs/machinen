# Node Level 5 product snapshot/restore surface

Node Level 5 support now uses the product-shaped surface first:

```sh
machinen snapshot node <pid> \
  --out ./node-snapshot

machinen restore ./node-snapshot
```

This path does not require an experimental Node Level 5 flag. `snapshot node <name|pid>` resolves a target, inspects live process evidence for pid targets, discovers the process cwd as the app root, then runs the Node Level 5 detector before capture. It accepts the supported idle HTTP app shape and refuses non-Node targets, missing app roots, or unsupported Node state before writing a snapshot.

The detector report, target identity report, and product capture report are retained inside the snapshot and verified during restore. Restore also writes a target-native materialization report, a launch report, and a behavioral verifier report. The behavioral verifier starts target-native Node in the restored app root, serves an HTTP loopback response, and probes it before accepting restore. Proof corpus fixtures can also provide `machinen-node-level5-behavior.json` to launch a real app entry and retain route, status, body, and header evidence. Release checks can retain those rows in `node-level5-real-app-corpus-report.json` and include the report with `machinen node-level5 release-gate --include-real-app-corpus --corpus-report <file>`. The product-run corpus generator in `scripts/node-level5-real-app-product-run-corpus.ts` builds that report by running `machinen snapshot node <pid> --out <dir>` and `machinen restore <dir>` against Express/Fastify fixtures. These reports keep the boundary clear: no raw CPU restore, source ISA emulation, or metadata-only success. The product path no longer depends on `machinen-node-level5-targets.json`; proof fixtures now use real pid introspection for the target-bound path. The path still keeps the support boundary narrow:

- Node product support: 80%.
- Broad Node product support: 20%.
- Arbitrary process cross-architecture restore: 0%.
- Raw CPU restore: not supported.
- Source ISA emulation: not supported.

The diagnostic `machinen node-level5 ...` commands remain useful for release gates and support triage, but they are no longer the primary product shape. The product direction is snapshot first, restore second, with retained detector evidence and artifact evidence checked behind the scenes.
