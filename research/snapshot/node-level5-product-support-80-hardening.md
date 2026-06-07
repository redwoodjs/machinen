# Node Level 5 80% hardening

The 80% Node product support tier requires retained evidence. This page defines the hardening policy for artifact bundles, verification, CI retention, operator support, and claim boundaries.

## Artifact bundle schema

Each real VM cross-architecture bundle must include:

- `manifest.json`
- `capture-summary.json`
- `restore-summary.json`
- `target.log`
- `target-native-verifier.json`
- `behavioral-verifier.json`
- `refusal-rows.json`
- `version-info.json`
- `triage-bundle.json`

The bundle must identify the supported family and direction: `arm64 -> amd64` or `amd64 -> arm64`.

## Verification policy

A bundle is accepted only when:

- Manifest, capture summary, restore summary, target logs, target-native verifier, behavioral verifier, refusal rows, version info, and triage bundle are present.
- Target-native Node is verified.
- Behavioral verification passes.
- Raw CPU restore is not used.
- Source ISA emulation is not used.
- Metadata-only success is not accepted.

## CI retention contract

CI must retain Node 80% artifacts for 30 days. Artifact names must include:

- support tier: `node-level5-80`
- supported family
- cross-architecture direction
- run attempt

## Version and ABI policy

The 80% tier supports Node `22.x`, V8 `12.x pointer-compressed`, and the declared libuv boundary. Unknown Node/V8/libuv ABI must refuse before target start.

## Detector registry

Unsupported detectors are stable and must retain refusal artifacts for workers, native addons, Wasm/external memory, TLS active state, active async in-flight work, child process live state, raw CPU restore, and source ISA emulation.

## Operator runbook

For support cases, collect the full artifact bundle, the family name, the architecture direction, and the refusal row if the workload was outside support. If an artifact bundle is missing, treat the case as not proven.

## Claim boundary

The hardened claim remains:

```json
{
  "nodeProductSupportClaimed": 80,
  "broadNodeProductSupportClaimed": 20,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

This does not claim arbitrary Node app support.
