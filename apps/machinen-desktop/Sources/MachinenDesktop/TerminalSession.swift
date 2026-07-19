import Darwin
import Foundation

final class WorkspaceRecord: Codable {
    let id: String
    var name: String

    init(id: String = "ws_" + UUID().uuidString.lowercased(), name: String) {
        self.id = id
        self.name = name
    }
}

struct TerminalLaunch: Codable {
    enum Kind: String, Codable {
        case loginShell
        case shellCommand
        case exec
    }

    var kind: Kind
    var command: String?
    var executable: String?
    var arguments: [String]?
    var environment: [String: String]?

    static let loginShell = TerminalLaunch(kind: .loginShell)

    static func shellCommand(_ command: String) -> TerminalLaunch {
        TerminalLaunch(kind: .shellCommand, command: command)
    }

    static func executable(
        _ executable: String,
        arguments: [String],
        environment: [String: String]?
    ) -> TerminalLaunch {
        TerminalLaunch(
            kind: .exec,
            executable: executable,
            arguments: arguments,
            environment: environment
        )
    }
}

final class TerminalSession: Codable {
    enum State: String, Codable {
        case starting
        case running
        case stopped
        case exited
        case disconnected
        case detached
    }

    enum ActivityState: String, Codable {
        case working
        case waiting
        case idle
        case unknown
    }

    let id: String
    let tileID: String
    var label: String
    var workspaceID: String
    var workspace: String
    var name: String
    var launch: TerminalLaunch
    var workingDirectory: String
    var state: State
    var activityState: ActivityState

    init(
        id: String = "term_" + UUID().uuidString.lowercased(),
        tileID: String = "tile_" + UUID().uuidString.lowercased(),
        label: String,
        workspaceID: String,
        workspace: String,
        name: String,
        launch: TerminalLaunch,
        workingDirectory: String,
        state: State = .starting,
        activityState: ActivityState = .unknown
    ) {
        self.id = id
        self.tileID = tileID
        self.label = label
        self.workspaceID = workspaceID
        self.workspace = workspace
        self.name = name
        self.launch = launch
        self.workingDirectory = workingDirectory
        self.state = state
        self.activityState = activityState
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case tileID
        case label
        case workspaceID
        case workspace
        case name
        case launch
        case command
        case workingDirectory
        case state
        case activityState
    }

    required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        tileID = try container.decodeIfPresent(String.self, forKey: .tileID)
            ?? "tile_" + UUID().uuidString.lowercased()
        label = try container.decode(String.self, forKey: .label)
        workspaceID = try container.decodeIfPresent(String.self, forKey: .workspaceID) ?? ""
        workspace = try container.decode(String.self, forKey: .workspace)
        name = try container.decode(String.self, forKey: .name)
        if let decodedLaunch = try container.decodeIfPresent(TerminalLaunch.self, forKey: .launch) {
            launch = decodedLaunch
        } else if let command = try container.decodeIfPresent(String.self, forKey: .command) {
            launch = .shellCommand(command)
        } else {
            launch = .loginShell
        }
        workingDirectory = try container.decode(String.self, forKey: .workingDirectory)
        state = try container.decode(State.self, forKey: .state)
        activityState = try container.decodeIfPresent(ActivityState.self, forKey: .activityState) ?? .unknown
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(tileID, forKey: .tileID)
        try container.encode(label, forKey: .label)
        try container.encode(workspaceID, forKey: .workspaceID)
        try container.encode(workspace, forKey: .workspace)
        try container.encode(name, forKey: .name)
        try container.encode(launch, forKey: .launch)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encode(state, forKey: .state)
        try container.encode(activityState, forKey: .activityState)
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
            "Starting persistent terminal…\n\nworkspace: \(workspace)\nterminal:  \(name)\n"
        case .running:
            "Attaching to persistent terminal…"
        case .stopped:
            "Terminal stopped.\n\nUse Terminal: Restart to launch it again."
        case .exited:
            "Terminal process exited.\n\nUse Terminal: Restart to launch it again."
        case .disconnected:
            "Terminal viewer disconnected.\n\nUse Terminal: Reconnect."
        case .detached:
            "Viewer detached.\n\nThe process continues behind dtach socket:\n\(socketPath)"
        }
    }

    static func bootstrap() -> MachinenStoredState {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let workspaces = [
            WorkspaceRecord(id: "ws_website", name: "website"),
            WorkspaceRecord(id: "ws_api", name: "api"),
            WorkspaceRecord(id: "ws_experiment", name: "experiment"),
            WorkspaceRecord(id: "ws_docs", name: "docs"),
        ]
        let sessions = [
            TerminalSession(
                id: "term_website_shell",
                tileID: "tile_website_shell",
                label: "ws",
                workspaceID: "ws_website",
                workspace: "website",
                name: "shell",
                launch: .loginShell,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "term_website_shell_2",
                tileID: "tile_website_shell_2",
                label: "w2",
                workspaceID: "ws_website",
                workspace: "website",
                name: "shell 2",
                launch: .loginShell,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "term_api_shell",
                tileID: "tile_api_shell",
                label: "as",
                workspaceID: "ws_api",
                workspace: "api",
                name: "shell",
                launch: .loginShell,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "term_experiment_shell",
                tileID: "tile_experiment_shell",
                label: "es",
                workspaceID: "ws_experiment",
                workspace: "experiment",
                name: "shell",
                launch: .loginShell,
                workingDirectory: home,
                state: .running
            ),
            TerminalSession(
                id: "term_docs_shell",
                tileID: "tile_docs_shell",
                label: "ds",
                workspaceID: "ws_docs",
                workspace: "docs",
                name: "shell",
                launch: .loginShell,
                workingDirectory: home,
                state: .running
            ),
        ]
        return MachinenStoredState(workspaces: workspaces, sessions: sessions)
    }
}

struct MachinenStoredState {
    var workspaces: [WorkspaceRecord]
    var sessions: [TerminalSession]
}
