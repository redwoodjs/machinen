import Foundation

struct MockSession {
    enum State: String {
        case working
        case live
        case waiting
        case starting
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
            state: .live,
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
            state: .working,
            terminalText: """
            pi

            I'll compare all three approaches.

            $ hyperfine './bench-a' './bench-b'
            Benchmark 1: ./bench-a
              Time (mean ± σ): 124.2 ms

            Benchmark 2: ./bench-b
              Time (mean ± σ): {{tick}}.7 ms
            ▌
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
