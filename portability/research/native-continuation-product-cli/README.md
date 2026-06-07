# Product-shaped experimental native CLI

This lane shapes the research primitive as the guarded product command family we
want to expose later:

```sh
python3 machinen_native.py native classify --pid <pid>
python3 machinen_native.py native capture --pid <pid> --out capture.json
python3 machinen_native.py native materialize --descriptor capture.json --out result.json
```

It validates descriptors before materialization and refuses invalid descriptors.
Application descriptors are accepted only as descriptor-contract materialization
here; the full target-native runtime proofs remain in the retained application
ladders.

The command remains research-only. It does not claim arbitrary process restore,
source-ISA emulation, raw heap/stack/register materialization, JavaScript heap
restore, PostgreSQL backend/session memory restore, or kernel socket identity
preservation.

Run:

```sh
portability/research/native-continuation-product-cli/verify.sh
```
