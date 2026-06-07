# Native continuation application adapters

This lane separates application-specific safe-point interpretation from the
generic `/proc` classifier.

Layers:

1. generic CPU/memory/resource classifier
2. application adapter (`app_adapters.py`)
3. descriptor normalizer (`descriptor_for_application`)
4. schema/contract validator (`schema_contract.py`)
5. target-native materializer selection in the relevant ladder/CLI

Adapters currently cover Node.js, PostgreSQL, and Redis shapes. Accepted rows
emit architecture-neutral descriptors. Refused rows emit no descriptor.

Run:

```sh
python3 portability/research/native-continuation-app-adapters/verify_adapters.py
```

Retained output: `retained/report.json`.
