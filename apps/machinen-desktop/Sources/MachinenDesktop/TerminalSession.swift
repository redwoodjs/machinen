import Darwin
import Foundation

final class TerminalSession: Codable {
    enum State: String, Codable {
        case starting
        case running
        case stopped
        case disconnected
        case detached
    }

    let id: String
    let label: String
    let workspace: String
    let name: String
    let command: String?
    let workingDirectory: String
    var state: State

    init(
        id: String = UUID().uuidString.lowercased(),
        label: String,
        workspace: String,
        name: String,
        command: String?,
        workingDirectory: String,
        state: State = .starting
    ) {
        self.id = id
        self.label = label
        self.workspace = workspace
        self.name = name
        self.command = command
        self.workingDirectory = workingDirectory
        self.state = state
    }

    var socketPath: String {
        let directory = "/tmp/machinen-\(getuid())"
        try? FileManager.default.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let safeID = id.lowercased().map { character in
            character.isLetter || character.isNumber ? character : "-"
        }
        return directory + "/" + String(safeID.prefix(36)) + ".sock"
    }

    var terminalText: String {
        switch state {
        case .starting:
            "Starting persistent terminal…\n\nworkspace: \(workspace)\nsession:   \(name)\n"
        case .running:
            "Attaching to persistent terminal…"
        case .stopped:
            "Session stopped.\n\nUse Session: Restart to launch it again."
        case .disconnected:
            "Terminal viewer disconnected.\n\nUse Session: Reconnect."
        case .detached:
            "Viewer detached.\n\nThe process continues behind dtach socket:\n\(socketPath)"
        }
    }

    static func bootstrap() -> [TerminalSession] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            TerminalSession(
                id: "website-shell",
                label: "ws",
                workspace: "website",
                name: "shell",
                command: nil,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "website-shell-2",
                label: "w2",
                workspace: "website",
                name: "shell 2",
                command: nil,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "api-shell",
                label: "as",
                workspace: "api",
                name: "shell",
                command: nil,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "experiment-shell",
                label: "es",
                workspace: "experiment",
                name: "shell",
                command: nil,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "docs-shell",
                label: "ds",
                workspace: "docs",
                name: "shell",
                command: nil,
                workingDirectory: home,
                state: .running
            ),
        ]
    }
}
