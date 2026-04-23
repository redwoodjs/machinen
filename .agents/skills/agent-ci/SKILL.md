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

Run it raw. Do NOT pipe it to `tail`, `head`, or any other filter — those
buffer until the process exits, so on failure you see only the tail of the
last step instead of which step actually failed. `--quiet` only suppresses
the animated renderer; the remaining output is the signal you need.

`--pause-on-failure` is the key flag: when a step fails the runner pauses
and waits for retry. You MUST watch the output for that pause — without
attention, a paused runner sits idle and looks like progress.

For long runs, launch with `run_in_background: true` and attach a Monitor
to the output file so failures and pauses surface as they happen. Don't
just wait for the completion notification.

```
tail -f <output-file> | grep -E --line-buffered "Step failed|FAILED|Error|Traceback|To retry:|All steps passed|agent-ci retry"
```

(The `tail -f` here is a Monitor input pattern — never use `tail` to
truncate Bash output.)

## Retry

When a step fails, the runner pauses and prints a `To retry:` line with
the exact command to use. Fix the issue, then run THAT command verbatim
— don't invent your own. Example shape:

```bash
npx @redwoodjs/agent-ci retry --name <runner-name>
```

To re-run from an earlier step (rare — only when the suggested command
isn't enough):

```bash
npx @redwoodjs/agent-ci retry --name <runner-name> --from-step <N>
```

Repeat fix → retry until all jobs pass. Do not push to trigger remote CI
when agent-ci can run it locally.
