# Machinen Desktop services

Trusted TypeScript services that use [`@machinen/desktop-sdk`](../../packages/desktop-sdk/README.md)
to add behavior to Machinen Desktop. These are desktop services, not an agent
runtime; Eve or Flue can consume the same SDK independently.

## Git status proof

Open Machinen Desktop, then run:

```sh
pnpm -F @machinen/desktop-services dev
```

The service subscribes to workspace and UI events, probes the selected local or
SSH workspace every four seconds, and publishes the existing `machinen.git`
status widget with a ten-second TTL. The external widget overrides the current
Swift implementation. If the service stops, its widget expires and the Swift
fallback returns automatically.

The service uses `/usr/bin/git`, `/usr/bin/ssh`, and the user's OpenSSH
configuration. Set `MACHINEN_API_SOCKET` to use a non-default Desktop socket.

This package is intentionally not embedded in `Machinen.app` yet. Runtime
bundling and supervision follow after the service has been proven manually.
