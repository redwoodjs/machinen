# fork-pi

Boot a VM with the [`pi`](https://pi.dev) coding agent installed,
snapshot it, fork three siblings in parallel — each one asks `pi` a
different question.

## Prereq

Authenticate `pi` on the host once:

```sh
npm install -g @earendil-works/pi-coding-agent
pi
/login
```

`run.ts` mounts `~/.pi/agent/` into the source VM at `/mnt/pi-agent`; the
baked image links that to `/root/.pi/agent`, so each fork inherits the same
session.

## Run

```sh
pnpm install
pnpm bake        # ~few minutes, idempotent after first success
pnpm start
```

The three forks each get a different fizzbuzz prompt and print the
answer.
