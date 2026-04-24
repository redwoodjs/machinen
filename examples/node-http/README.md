# examples/node-http

A minimal Node HTTP server running inside a microVM, reachable from
the host on `localhost:8080`.

Demonstrates four things end-to-end:

1. **Node in the guest** — `provision({ install })` boots the base
   Debian rootfs, runs `apt-get install -y nodejs` inside, and writes
   a Node-capable image to `./.cache/node-image.tar.gz`. First run
   only; cached thereafter.
2. **Baked-in default cmd** — the image carries a
   `/machinen-config.json` with `cmd: ["/usr/bin/node",
"/mnt/app/server.mjs"]`, so `boot({ image })` runs it without any
   extra args.
3. **App files into the guest** — the example's `rootfs/server.mjs`
   is exposed at `/mnt/app/` via `mount`, so edits don't require
   rebuilding the image.
4. **Host reaches a guest TCP port** — `portForward: [{ hostPort:
8080, guestPort: 3000 }]` installs a host → guest forward through
   gvproxy's control API. `127.0.0.1:8080` on the host is routed to
   port 3000 on the guest.

## Run it

```sh
pnpm install
pnpm -F @machinen/example-node-http start
```

From another terminal:

```sh
curl http://localhost:8080/
# hello from microvm
```

First run takes a couple of minutes while `apt-get` installs nodejs.
Subsequent runs are fast — the image is cached in `./.cache/`.

## The runtime API

`run.ts` is the whole driver. The shape you'd use in your own code:

```ts
import { boot, provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update");
    await vm.exec("apt-get install -y --no-install-recommends nodejs");
  },
  cmd: ["/usr/bin/node", "/mnt/app/server.mjs"],
  env: { NODE_NO_WARNINGS: "1" },
  out: "./node-image.tar.gz",
});

const vm = await boot({
  image: "./node-image.tar.gz",
  mount: { host: "./rootfs", guest: "/mnt/app" },
  portForward: [{ hostPort: 8080, guestPort: 3000 }],
});
```

`portForward` takes `{ hostPort, guestPort, hostAddr? }` entries.
`hostAddr` defaults to `127.0.0.1` (loopback-only); set it to
`0.0.0.0` if you want LAN exposure.

## The CLI equivalent

Once `.cache/node-image.tar.gz` exists, the same thing through
`machinen boot`:

```sh
machinen boot ./.cache/node-image.tar.gz \
  -p 8080:3000 \
  --mount ./rootfs:/mnt/app
```

No `-- <cmd>` needed — the image carries its default. The CLI's
`-p <hostPort>:<guestPort>` flag is repeatable. Host bind is always
`127.0.0.1` from the CLI; drop to the runtime API if you need
`0.0.0.0`.
