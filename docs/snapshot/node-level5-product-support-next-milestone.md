# Node Level 5 100 / 100 / 0 milestone

This milestone is now claimed. Machinen moves from **90 / 30 / 0** to **100 / 100 / 0** for selected Node service support.

## Current claim

| Claim                                        | Current value | Meaning                                                                                               |
| -------------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------- |
| Node product support                         |          100% | The selected Node service claim ladder is release-gated through final Node-service GA evidence.       |
| Broad Node product support                   |          100% | Broad Node service support is claimed for the safe idle service taxonomy and retained evidence gates. |
| Arbitrary process cross-architecture restore |            0% | Machinen does not claim arbitrary Linux process restore.                                              |

## Evidence gates

The claim is backed by every planned Node service tier:

1. 95 / 40 / 0 — framework capability coverage v2;
2. 97 / 50 / 0 — framework combination corpus;
3. 98 / 60 / 0 — Node runtime capability matrix;
4. 99 / 70 / 0 — installed framework app release gate;
5. 99 / 80 / 0 — broad Node capability claim-ready gate;
6. 100 / 85 / 0 — unified Node service claim gate;
7. 100 / 90 / 0 — cross-corpus consistency gate;
8. 100 / 95 / 0 — runtime-state translation gate;
9. 100 / 98 / 0 — runtime + framework combined claim-ready gate;
10. 100 / 100 / 0 — final Node-service GA gate.

## Non-goals

- Do not claim arbitrary non-Node process support.
- Do not use app-exported state, checkpoint hooks, selected-state descriptors, sidecar replay, source-ISA emulation, raw CPU restore, or metadata-only success.
- Do not implement runtime-profile snapshot/restore as the product path.
- Do not raise arbitrary process cross-architecture restore above `0%`.
