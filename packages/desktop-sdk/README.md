# `@machinen/desktop-sdk`

TypeScript client for Machinen Desktop's versioned, same-user Unix-socket API.
It exposes desktop capabilities without imposing an agent or workflow runtime.
Eve, Flue, ordinary scripts, and built-in desktop services can all use the same
SDK.

```ts
import { MachinenDesktopClient } from "@machinen/desktop-sdk";

const desktop = new MachinenDesktopClient({
  client: { name: "example", version: "1" },
  initialSubscription: {
    events: ["workspace.*", "ui.changed"],
    includeSnapshot: true,
  },
});

const connection = await desktop.connect();
console.log(connection.subscription?.snapshot);

desktop.onEvent((event) => {
  console.log(event.event, event.data);
});

await desktop.commands.set({
  id: "example.yazi-cwd",
  title: "Open terminal directory in Yazi",
  context: "terminal",
  ttlMilliseconds: 30_000,
});

await desktop.selectionOpeners.set({
  id: "example.open-markdown",
  title: "Glow",
  ttlMilliseconds: 30_000,
});

await desktop.terminals.resize("term_123", 120, 36);

await desktop.status.set({
  id: "example.ready",
  kind: "state",
  states: ["good"],
  tooltip: "Example service is connected",
  ttlMilliseconds: 10_000,
  links: [{ title: "Open dashboard", url: "http://localhost:3000" }],
});
```

The default socket is `/tmp/machinen-<uid>/api-v1.sock`.
`MACHINEN_API_SOCKET` overrides it. On macOS the client asks Launch Services to
open Machinen when needed unless `launchApplication` is `false` or
`MACHINEN_DESKTOP_NO_LAUNCH=1`.

The SDK contains transport, protocol, workspace, terminal, UI, event, context
command, selection opener, and status widget types. Agent loops, model providers, workflows, prompts, and memory belong
in higher-level systems such as Eve or Flue.
