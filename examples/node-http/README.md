# examples/node-http

A minimal Node HTTP server running inside a microVM, reachable from
the host on `localhost:8080`.

Demonstrates three things end-to-end:

1. **Node in the guest** — `build({ install })` boots the base Debian
   rootfs, runs `apt-get install -y nodejs` inside, and writes a
   Node-capable tarball to `./.cache/node-rootfs.tar.gz`. First run
   only; cached thereafter.
2. **App files into the guest** — the bundle's `rootfs/server.mjs` is
   merged on top of the base rootfs at pack time, so `/server.mjs`
   exists inside the VM.
3. **Host reaches a guest TCP port** — `portForward: [{ hostPort: 8080,
guestPort: 3000 }]` installs a host → guest forward through
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
Subsequent runs are fast — the install output is cached in
`./.cache/`.

## The runtime API

`run.ts` is the whole driver. The shape you'd use in your own code:

```ts
import { build, spawn } from "@machinen/runtime";

await build({
  install: async (vm) => {
    await vm.exec("apt-get update");
    await vm.exec("apt-get install -y --no-install-recommends nodejs");
  },
  out: "./node-rootfs.tar.gz",
});

const vm = await spawn({
  baseRootfs: "./node-rootfs.tar.gz",
  bundle: "./examples/node-http",
  portForward: [{ hostPort: 8080, guestPort: 3000 }],
});
```

`portForward` takes `{ hostPort, guestPort, hostAddr? }` entries.
`hostAddr` defaults to `127.0.0.1` (loopback-only); set it to
`0.0.0.0` if you want LAN exposure.

## The CLI equivalent

Once you have a Node-capable base tarball on hand, the same thing
through `machinen run`:

```sh
MACHINEN_ASSETS_DIR=/path/with/node-rootfs \
  machinen run ./examples/node-http -p 8080:3000
```

The CLI's `-p <hostPort>:<guestPort>` flag is repeatable. Host bind
is always `127.0.0.1` from the CLI; drop to the runtime API if you
need `0.0.0.0`.
