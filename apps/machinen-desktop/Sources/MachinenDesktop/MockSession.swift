import Foundation

struct MockSession {
    enum State: String {
        case starting
        case working
        case waiting
        case idle
        case stopped
        case disconnected
        case detached
    }

    let label: String
    let workspace: String
    let name: String
    let state: State
    let terminalText: String
}

extension MockSession {
    static let phaseOne: [MockSession] = [
        MockSession(
            label: "wc",
            workspace: "website",
            name: "claude",
            state: .working,
            terminalText: """
            claude

            ● I found the routing issue. Updating
              src/app/router.ts...

              Edit(src/app/router.ts)
              Added 12 lines, removed 4

            ● Running tests... {{tick}}/84
            ▌
            """
        ),
        MockSession(
            label: "ws",
            workspace: "website",
            name: "shell",
            state: .idle,
            terminalText: """
            ~/workspace $ pnpm dev

            VITE v7.2.0 ready in 241 ms

              ➜ Local:   http://localhost:5173/
              ➜ Network: http://10.0.2.15:5173/

            12:41:{{tick}} PM [vite] page reload
            ▌
            """
        ),
        MockSession(
            label: "ac",
            workspace: "api",
            name: "codex",
            state: .waiting,
            terminalText: """
            codex

            Proposed plan:

            1. Add the migration
            2. Backfill existing rows
            3. Update the generated client

            Proceed with this plan? [y/N]
            ▌
            """
        ),
        MockSession(
            label: "ep",
            workspace: "experiment",
            name: "pi",
            state: .disconnected,
            terminalText: """
            Connection to the terminal was lost.

            workspace: experiment
            session:   pi
            node:      studio.p4p8.local

            Last heartbeat: 12:41:38 PM
            Error: transport closed without a close frame

            The process may still be running.
            Use Session: Reconnect or inspect diagnostics.
            """
        ),
        MockSession(
            label: "as",
            workspace: "api",
            name: "shell",
            state: .stopped,
            terminalText: """
            Session stopped.

            command:   pnpm test --watch
            exit code: 130
            stopped:   12:37:04 PM

            The workspace is still running.
            Use Session: Restart to start this command again.
            """
        ),
        MockSession(
            label: "dc",
            workspace: "docs",
            name: "claude",
            state: .starting,
            terminalText: """
            Starting workspace...

            ✓ Preparing project
            ✓ Starting machine
            · Connecting terminal
            · Starting Claude Code

            ▌
            """
        ),
    ]
}
