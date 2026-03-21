---
"@redwoodjs/agent-ci": patch
---

Fix Node 22 crash caused by `@actions/workflow-parser` importing JSON without the required `type: "json"` import attribute. A custom ESM loader hook now transparently adds the missing attribute at runtime.
