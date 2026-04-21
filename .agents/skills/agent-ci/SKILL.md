---
name: agent-ci
description: Run GitHub Actions CI locally with Agent CI to validate changes before pushing. Use when testing, running checks, or validating code changes.
license: MIT
compatibility: Requires Node.js 18+ and Docker
metadata:
  author: redwoodjs
  version: "1.0.0"
---

# Agent CI

Run the full CI pipeline locally before pushing. CI was green before you started — any failure is caused by your changes.

## Run

```bash
npx @redwoodjs/agent-ci run --quiet --all --pause-on-failure
```

Run the command raw. Do NOT pipe it to `tail`, `head`, or similar filters —
those buffer until the process exits, so progress is invisible and on failure
you see only the tail of the last step instead of which step failed. `--quiet`
already suppresses the animated renderer; the remaining output is the signal
you need.

If the run will exceed the Bash tool's foreground timeout, launch it with
`run_in_background: true` and read the output file directly (the path is
returned with the task ID). Do not wrap it in `tail`.

## Retry

When a step fails, the run pauses automatically. Fix the issue, then retry:

```bash
npx @redwoodjs/agent-ci retry --name <runner-name>
```

To re-run from an earlier step:

```bash
npx @redwoodjs/agent-ci retry --name <runner-name> --from-step <N>
```

Repeat until all jobs pass. Do not push to trigger remote CI when agent-ci can run it locally.
