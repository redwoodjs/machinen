# Node Level 5 65% compatibility matrix

| Node facility                   | 65% tier status | Notes                                                   |
| ------------------------------- | --------------- | ------------------------------------------------------- |
| Eleven 50% service families     | Supported       | Inherited from the 50% tier.                            |
| Active async idle boundary      | Supported       | Only idle async resources and empty active work queues. |
| In-flight async operations      | Refused         | Outside the 65% tier.                                   |
| TLS boundary policy             | Supported       | Live TLS state has stable refusal and artifacts.        |
| Full TLS session migration      | Refused         | Outside the 65% tier.                                   |
| Child process boundary          | Supported       | Completed child exit state only.                        |
| Live child process continuation | Refused         | Outside the 65% tier.                                   |
| Raw CPU restore                 | Refused         | Cross-architecture continuation must be translated.     |
| Source ISA emulation            | Refused         | Not a product path.                                     |
| Native addons                   | Refused         | Outside the 65% tier.                                   |
| Wasm modules                    | Refused         | Outside the 65% tier.                                   |
