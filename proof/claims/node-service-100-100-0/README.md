# Node service 100 / 100 / 0

Status: `claimed`

Track: `node-service`

Proof directory: `proof/claims/node-service-100-100-0`

Scope: Selected safe Node services through VM-first snapshot/restore.

Promotion effect: Public Node service claim is already raised; does not affect arbitrary-process claim.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Proofs

| Proof                         | Category           | Status   | Artifact                                     | Proves                                                 | Claim use                                  | Next                                                            |
| ----------------------------- | ------------------ | -------- | -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| `node-service-claim-ladder`   | claim ladder       | `passed` | `node-level5-product-support-100.json`       | 100 / 100 / 0 selected Node service claim ladder       | backs current Node service claim           | Keep no-regression gates green.                                 |
| `node-framework-capabilities` | framework evidence | `passed` | `node-level5-framework-capability-matrix.md` | Express/Fastify capability rows with exact diagnostics | supports framework capability portion only | Do not expand to arbitrary framework apps without new evidence. |
| `node-vm-product-path`        | product UX         | `passed` | `node-level5-product-snapshot-restore.md`    | machinen snapshot / restore product path and metadata  | backs VM-first UX requirement              | Preserve the product path for future runtimes.                  |
