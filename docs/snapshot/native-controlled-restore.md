# Native controlled restore proof

Issue #450 combines the native translation pieces into one controlled restore
pipeline.

## Command

```sh
pnpm native-controlled-restore
```

The proof builds a synthetic arm64 capture/amd64 target image, maps the source
resume symbol to the target resume symbol, translates one safe thread register
set, translates one stack frame, relocates one data pointer, turns a regular
file into a resource recipe, validates the resulting native process image, and
materializes the translated memory with the native restore loader.

## What is proven

The pipeline proves that the components agree on one bundle contract:

- #446 code locations feed #445 register continuations and #447 return-address
  translation;
- #447 stack relocations and #448 memory relocations are emitted into
  `native-translation.json`;
- #449 resource recipes are emitted into `native-resources.json`;
- #444 materializes the translated memory payload.

## Remaining boundary

The proof records `execution: materialized-translated-state-without-final-jump`.
That is deliberate: this issue proves the translated image can be assembled and
materialized, but it does not yet jump into a recreated Linux thread context.
Unknown frame metadata still refuses as `mapping-ambiguous`.

The next step is applying this pipeline to real utilities and cataloguing which
resources/metadata prevent a final transparent jump.
