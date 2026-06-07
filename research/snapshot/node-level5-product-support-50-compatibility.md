# Node Level 5 50% compatibility matrix

| Node facility                        | 50% tier status | Notes                                               |
| ------------------------------------ | --------------- | --------------------------------------------------- |
| Idle HTTP listener                   | Supported       | Existing 20% family.                                |
| Timer service                        | Supported       | Existing 20% family.                                |
| Plain JavaScript heap                | Supported       | Existing 20% family.                                |
| Readonly file / stdio                | Supported       | Existing 20% family.                                |
| Pipes / streams idle boundary        | Supported       | Existing 20% family.                                |
| HTTP keepalive idle pool             | Supported       | Idle only; active requests refused.                 |
| Completed microtask checkpoint       | Supported       | Pending microtasks refused.                         |
| Promise / async closure graph        | Supported       | Idle settled graph only.                            |
| CommonJS / ESM module cache          | Supported       | Loader hooks refused.                               |
| JSON / config / data heap graph      | Supported       | Pure data only.                                     |
| Graceful shutdown / server lifecycle | Supported       | Child process and custom signal state refused.      |
| TLS                                  | Refused         | Outside 50% tier.                                   |
| Worker threads                       | Refused         | Outside 50% tier.                                   |
| Native addons                        | Refused         | Outside 50% tier.                                   |
| Wasm modules                         | Refused         | Outside 50% tier.                                   |
| External memory                      | Refused         | Outside 50% tier.                                   |
| Raw CPU restore                      | Refused         | Cross-architecture continuation must be translated. |
| Source ISA emulation                 | Refused         | Not a product path.                                 |
