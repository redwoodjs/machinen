# Machinen Desktop services

Trusted TypeScript services that use [`@machinen/desktop-sdk`](../../packages/desktop-sdk/README.md)
to add behavior to Machinen Desktop. These are desktop services, not an agent
runtime; Eve or Flue can consume the same SDK independently.

## Status services

The service publishes all of Desktop's live status items through `status.set`:

- workspace terminal activity
- local/SSH Git status
- open TCP ports whose listener process is running in the selected workspace folder
- overview host CPU and network transfer
- workspace tile CPU and network transfer
- focused-terminal PID, CPU, and network transfer

Local and SSH workspace probes follow the selected workspace and refresh without
restarting Desktop. Open ports are matched by listener PID and current working
directory; a listener is included when its working directory is the workspace
folder or one of its descendants. CPU and network widgets retain the same
30-sample histories and spatial scopes as their native predecessors.

Every published widget has a short TTL, so stale data disappears if a probe or
the service stops. A packaged `Machinen.app` includes a compiled copy of this
service and a Node.js runtime. Desktop starts that child after its API is ready,
restarts unexpected exits with bounded backoff, and stops it when Desktop quits.
The child also exits if its supervision pipe closes, so an app crash does not
leave an orphan service behind.

For source development, open Machinen Desktop with `swift run` and run:

```sh
pnpm -F @machinen/desktop-services dev
```

`pnpm dev` watches the TypeScript source and reloads widget logic without
restarting Desktop. Set `MACHINEN_API_SOCKET` when the source service should use
a non-default Desktop socket.

The services use macOS process tools, `/usr/bin/git`, `/usr/bin/ssh`, and the
user's OpenSSH configuration. Changes to the native status-bar renderer or
declarative widget protocol still require rebuilding Machinen Desktop.
