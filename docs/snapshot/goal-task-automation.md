# Goal task automation

`goal.md` is the long-running task ledger for transparent native cross-ISA
migration. The helper command below automates the repeated issue/branch/validate
/PR loop while keeping validation timings in a JSON log.

```sh
pnpm goal-task -- run \
  --title "Tighten one refusal boundary" \
  --branch pp-tighten-one-boundary \
  --issue-body-file /tmp/issue.md \
  --implementation-command "pnpm native-active-syscall-policy" \
  --validation-profile focused \
  --focused-vitest packages/runtime/src/__tests__/native-active-syscall-policy.test.ts \
  --validation-log /tmp/machinen-validation.json
```

Use `--dry-run --json` to see the exact `gh`, `git`, implementation, validation,
push, and PR commands without changing the worktree or GitHub state.

## Validation profiles

- `docs` — `build:docs`, format, lint, typecheck, optional focused Vitest, and
  fallow.
- `focused` — format, lint, typecheck, focused Vitest, and fallow.
- `vm` — `build:docs`, format, lint, typecheck, full Vitest, full
  `pnpm smoke-tests`, and fallow.
- `ci` — local Agent CI only.
- `none` — no validation commands.

Add `--include-ci` when a task explicitly needs local Agent CI after another
profile.

Every validation run writes a JSON log containing:

- branch and commit;
- base branch;
- selected validation profile;
- default or configured remote hosts/profile;
- validation log and goal file paths;
- every command, status, exit code, and elapsed time.

## PR bodies

Generate a reusable Problem/Solution/Validation body from a validation log:

```sh
pnpm goal-task -- pr-body \
  --problem "The proof runner was hard to repeat by hand." \
  --solution "This adds a checked command and records timings." \
  --validation-log /tmp/machinen-validation.json \
  --body-file /tmp/machinen-pr.md
```

## Goal ledger updates

After a PR merges, mark a matching goal item complete:

```sh
pnpm goal-task -- update-goal \
  --match "Add reusable PR body generation" \
  --status x
```

The command replaces the first matching checkbox status in `goal.md` with the
requested status. Use `--goal-file` to point at a fixture or alternate ledger.

## Manual issue close

GitHub may not auto-close issues when a PR targets `portable-snapshots` instead
of the default branch. Close those issues explicitly:

```sh
pnpm goal-task -- close-issue \
  --issue 729 \
  --comment "Completed in #730."
```
