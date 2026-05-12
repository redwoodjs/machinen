---
"@machinen/runtime": patch
---

`API.md` no longer carries "Defined in: errors.ts:145" links pointing
at private-repo source paths. The reference is leaner and stands on
its own without needing the source tree alongside it. typedoc
`disableSources` change with no behavioural impact.
