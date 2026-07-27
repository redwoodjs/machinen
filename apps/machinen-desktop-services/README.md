# Machinen Desktop services

Trusted TypeScript services that use [`@machinen/desktop-sdk`](../../packages/desktop-sdk/README.md)
to add behavior to Machinen Desktop. These are desktop services, not an agent
runtime; Eve or Flue can consume the same SDK independently.

## Status services

Open Machinen Desktop, then run:

```sh
pnpm -F @machinen/desktop-services dev
```

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
the service stops. `pnpm dev` watches the TypeScript source and restarts after an
edit, so widget logic reloads without restarting Desktop.

The services use macOS process tools, `/usr/bin/git`, `/usr/bin/ssh`, and the
user's OpenSSH configuration. Set `MACHINEN_API_SOCKET` to use a non-default
Desktop socket.

This package is intentionally not embedded in `Machinen.app` yet. Keep
`pnpm dev` running during development; runtime bundling and supervision follow
after the services have been proven manually. Changes to the native status-bar
renderer or declarative widget protocol still require rebuilding Machinen
Desktop.
