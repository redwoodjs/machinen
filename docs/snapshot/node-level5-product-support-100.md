# Node Level 5 100 / 100 / 0 support

Machinen now claims **100 / 100 / 0** for selected Node service support.

| Claim                                        | Value | Meaning                                                                                               |
| -------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------- |
| Node product support                         |  100% | The selected Node service claim ladder is release-gated through final Node-service GA evidence.       |
| Broad Node product support                   |  100% | Broad Node service support is claimed for the safe idle service taxonomy and retained evidence gates. |
| Arbitrary process cross-architecture restore |    0% | Machinen still does not claim arbitrary Linux process restore.                                        |

## Product path

The product path remains VM-first:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Machinen detects supported Node workloads inside the VM. Host PID snapshot remains harness-only behind `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1`.

## Evidence ladder

The claim is backed by the Node service claim ladder:

| Target        | Gate                                          |
| ------------- | --------------------------------------------- |
| 95 / 40 / 0   | Framework capability coverage v2              |
| 97 / 50 / 0   | Framework combination corpus                  |
| 98 / 60 / 0   | Node runtime capability matrix                |
| 99 / 70 / 0   | Installed framework app release gate          |
| 99 / 80 / 0   | Broad Node capability claim-ready gate        |
| 100 / 85 / 0  | Unified Node service claim gate               |
| 100 / 90 / 0  | Cross-corpus consistency gate                 |
| 100 / 95 / 0  | Runtime-state translation gate                |
| 100 / 98 / 0  | Runtime + framework combined claim-ready gate |
| 100 / 100 / 0 | Final Node-service GA gate                    |

## Boundaries

This claim is for Node services in the safe-state taxonomy. It does not claim arbitrary non-Node process restore, raw CPU restore, source ISA emulation, app checkpoint hooks, or unsafe live state. Arbitrary Linux process cross-architecture restore remains **0%**.
