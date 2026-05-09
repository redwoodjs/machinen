---
"@machinen/cli": minor
---

`exec`, `snapshot`, `fork`, `attach`, `repl`, and `stop` now take the target VM as a positional argument instead of `--name <name>` / `--pid <pid>`. `snapshot` also takes its `<out-dir>` as a second positional. The legacy flags still work for one release with a one-time deprecation warning per `(command, flag)` pair.

- `machinen exec worker -- ps aux`
- `machinen snapshot worker ./warm`
- `machinen fork worker --new-name worker-b --detach`
- `machinen stop 12345` (digits resolve as pid; non-digits as name)

A VM literally named `123` can't be targeted positionally — pass `--name 123` (with the deprecation warning) until renamed.

`agent-context` schema bumps to version 2: `CommandSpec` gains a `positionals` field and `FlagSpec` gains a `deprecated` field. Existing v1 consumers that ignore unknown fields keep working; consumers that want the positional surface should bump to v2.
