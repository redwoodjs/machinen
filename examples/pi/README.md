# pi

Boot a Machinen VM with the [`pi`](https://pi.dev) coding agent installed.
The VM gets a live mount of:

- the current directory at `/mnt/workspace`
- your host `~/.pi/agent` state at `/root/.pi/agent`

That lets you test `pi` in an isolated Linux VM while keeping your normal host
login/config.

## Prereq

Authenticate `pi` on the host once:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
/login
```

## Bake

```sh
pnpm install
pnpm bake
```

This writes `./artifacts/rootfs.tar.gz` with Node 24, git, ripgrep, and `pi`
installed.

## Interactive test

```sh
pnpm start
pnpm attach
```

Inside the attached shell:

```sh
cd /mnt/workspace
HOME=/root pi
```

The VM keeps running if you close the host terminal. Reattach with
`pnpm attach`. Stop it with:

```sh
pnpm stop
```

## One-shot prompt test

```sh
pnpm ask -- "Write fizzbuzz in TypeScript. Code only."
```

The script boots a throwaway VM, runs `pi -p`, prints the answer, then kills the
VM.

## Optional knobs

```sh
MACHINEN_PI_NAME=pi-test pnpm start
MACHINEN_PI_WORKSPACE=/path/to/project pnpm start
MACHINEN_PI_WORKSPACE=/path/to/project pnpm ask -- "Inspect this repo."
```

`MACHINEN_PI_WORKSPACE` defaults to this example directory.
