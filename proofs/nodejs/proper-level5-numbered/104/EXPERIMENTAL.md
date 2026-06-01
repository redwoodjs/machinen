# Proof 104 experimental CLI boundary

This file documents a **proof-only** command shape for the real guest-capture E2E lane.

```sh
node proofs/by-id/104/experimental-cli.mjs \
  --proof-only \
  --experimental-translated-continuation \
  --proof-100-summary proofs/by-id/100/checked-summary.json
```

The command refuses unless the caller explicitly opts into proof-only experimental mode. It also refuses any attempt to claim product support.

This is not a public supported CLI. It is a harness boundary for measuring the remaining distance to a future narrow experimental product claim.
