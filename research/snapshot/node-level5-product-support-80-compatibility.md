# Node Level 5 80% compatibility matrix

| Node facility                  | 80% tier status | Notes                                        |
| ------------------------------ | --------------- | -------------------------------------------- |
| Fourteen 65% families          | Supported       | Inherited from the 65% tier.                 |
| Express/Fastify-style HTTP app | Supported       | Idle HTTP app state only.                    |
| Dependency-heavy app           | Supported       | Pure JS dependency graph only.               |
| Streams/files mixed app        | Supported       | Idle streams and readonly files only.        |
| Worker threads                 | Refused         | Product boundary evidence retained.          |
| Native addons                  | Refused         | Product boundary evidence retained.          |
| Wasm / external memory         | Refused         | Product boundary evidence retained.          |
| TLS active state               | Refused         | Full TLS migration remains unsupported.      |
| Active async in-flight work    | Refused         | Only idle async boundary is supported.       |
| Child process live state       | Refused         | Live child continuation remains unsupported. |
| Raw CPU restore                | Refused         | Translated continuation is required.         |
| Source ISA emulation           | Refused         | Not a product path.                          |
