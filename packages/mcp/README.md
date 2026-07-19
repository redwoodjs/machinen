# `@machinen/mcp`

A local [Model Context Protocol](https://modelcontextprotocol.io/) server that
lets AI clients control Machinen Desktop.

```text
AI client
  ↕ MCP over stdio
machinen-mcp
  ↕ same-user Unix socket
Machinen Desktop
```

The MCP server is an adapter over Machinen's versioned local API. It does not
open a network port and does not implement a custom URL scheme.

## Configure

After the package is published, add this stdio server to any MCP-compatible
client:

```json
{
  "mcpServers": {
    "machinen": {
      "command": "npx",
      "args": ["-y", "@machinen/mcp"]
    }
  }
}
```

From a repository checkout, build it and point the client at the generated
entrypoint:

```sh
pnpm -F @machinen/mcp build
```

```json
{
  "mcpServers": {
    "machinen": {
      "command": "node",
      "args": ["/absolute/path/to/machinen/packages/mcp/dist/index.js"]
    }
  }
}
```

The server connects to:

```text
/tmp/machinen-<uid>/api-v1.sock
```

If Machinen is not running on macOS, the server asks Launch Services to open
`Machinen`. Set `MACHINEN_APP_PATH` when the app bundle is not installed in a
location Launch Services knows. Set `MACHINEN_API_SOCKET` to override the socket
path.

## Tools

The server exposes the same hierarchy as Machinen Desktop:

```text
Workspace
└── Tile
    └── Terminal
        └── persistent PTY process
```

Discovery:

- `machinen_get_state`

Workspaces:

- `workspace_list`, `workspace_get`, `workspace_create`, `workspace_update`
- `workspace_move`, `workspace_stop`, `workspace_restart`, `workspace_delete`

Tiles:

- `tile_list`, `tile_get`, `tile_create`, `tile_update`, `tile_move`
- `tile_attach`, `tile_detach`, `tile_delete`

Terminals:

- `terminal_get`, `terminal_send`, `terminal_signal`
- `terminal_stop`, `terminal_restart`
- `terminal_output`, `terminal_wait`

UI:

- `ui_get`, `ui_select`, `ui_focus`, `ui_enter`
- `ui_zoom_out`, `ui_overview`, `ui_activate`

`terminal_output` keeps the most recent 256 KiB observed while the MCP server is
running. `terminal_send` returns an `outputCursor`; pass it to `terminal_wait`
as `afterCursor` to ignore older output. `terminal_wait` can wait for literal
output text, process state, or both. Terminal output produced while its Machinen tile viewer is detached is
not available because the Desktop API does not buffer detached output.

## Trust

A configured MCP client can create terminals, execute arbitrary commands, send
PTY input, signal processes, and delete stopped tile definitions. It therefore
has shell-equivalent authority for the current macOS user. Configure this MCP
server only in clients you trust.
