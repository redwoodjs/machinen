# Level 4 ping resource continuation

Status: `proven-resource`

Track: `arbitrary-process`

Proof directory: `proof/claims/level4-ping-resource-continuation`

Scope: Ping/ICMP socket resource reconstruction evidence only; not arbitrary-process restore.

Promotion effect: Can seed the arbitrary-process resource table, but cannot raise arbitrary-process support by itself.

## Claim numbers

```json
{
  "productSupport": "resource-level",
  "broadSupport": "n/a",
  "arbitraryProcessCrossArchRestore": 0
}
```

## Proofs

| Proof                         | Category               | Status           | Artifact                                                         | Proves                                                       | Claim use                                   | Next                                                             |
| ----------------------------- | ---------------------- | ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| `level4-ping-socket-product`  | network resource       | `passed`         | `level4-ping-socket-product.md`                                  | ping socket resource continuation semantics                  | narrow resource proof row                   | Keep marked as resource evidence, not arbitrary process proof.   |
| `native-ping-socket-resource` | arbitrary-process seed | `seed-candidate` | `arbitrary-process-level5-seed/native-ping-socket-resource.json` | Ping evidence is represented as one native resource seed row | seed only; claimChangeAllowed remains false | Add retained verifier artifact before treating as verified seed. |
