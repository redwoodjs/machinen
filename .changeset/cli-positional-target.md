---
"@machinen/cli": minor
---

`exec`, `snapshot`, `fork`, `attach`, `repl`, and `stop` take the target VM as a positional argument. `snapshot` also takes its `<out-dir>` as a second positional. Digits-only resolves as a pid; everything else as a name.

- `machinen exec worker -- ps aux`
- `machinen snapshot worker ./warm`
- `machinen fork worker --new-name worker-b --detach`
- `machinen stop 12345`

A VM literally named `123` can't be targeted positionally — it'd resolve as a pid. Rename the VM if you hit this; there's no flag escape hatch.

`agent-context` schema bumps to version 2: `CommandSpec` gains a `positionals` field. v1 consumers that ignore unknown fields keep working.
