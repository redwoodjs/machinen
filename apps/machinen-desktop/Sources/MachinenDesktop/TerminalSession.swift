import Darwin
import Foundation

final class WorkspaceRecord: Codable {
    let id: String
    var name: String
    var location: WorkspaceLocation

    var workingDirectory: String {
        get { location.path }
        set { location.path = newValue }
    }

    init(
        id: String = "ws_" + UUID().uuidString.lowercased(),
        name: String,
        workingDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path,
        sshHost: String? = nil
    ) {
        self.id = id
        self.name = name
        location = sshHost.map { .ssh(host: $0, path: workingDirectory) }
            ?? .local(workingDirectory)
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case workingDirectory
        case location
    }

    required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        if let decoded = try container.decodeIfPresent(WorkspaceLocation.self, forKey: .location) {
            location = decoded
        } else {
            location = .local(
                try container.decodeIfPresent(String.self, forKey: .workingDirectory) ?? ""
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encode(location, forKey: .location)
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
    enum Backend: String, Codable {
        case dtach
        case machinenSession
    }

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
    var backend: Backend
    var location: WorkspaceLocation
    var workingDirectory: String {
        get { location.path }
        set { location.path = newValue }
    }
    var state: State
    var activityState: ActivityState
    var titleOverride: String?
    var observedCommand: String?
    /// Runtime-only name of the login shell, inferred from dtach's child PID.
    /// It is deliberately not persisted or allowed to replace a user-given name.
    var inferredShellName: String?
    /// A runtime label intentionally sent by the program inside the terminal.
    /// It takes precedence over the inferred shell name until cleared.
    var runtimeLabel: String?
    /// Live process identifiers from the dtach sidecar. They are never
    /// persisted because a restarted process gets new PIDs.
    var shellPID: Int32?
    var processPID: Int32?

    var associatedPID: Int32? {
        processPID ?? shellPID
    }

    var displayName: String {
        runtimeLabel ?? inferredShellName ?? name
    }

    var commandTitle: String {
        if let titleOverride, !titleOverride.isEmpty { return titleOverride }
        if let observedCommand, !observedCommand.isEmpty { return observedCommand }
        switch launch.kind {
        case .loginShell:
            return "shell"
        case .shellCommand:
            return launch.command ?? "command"
        case .exec:
            return launch.executable.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "command"
        }
    }

    init(
        id: String = "term_" + UUID().uuidString.lowercased(),
        tileID: String = "tile_" + UUID().uuidString.lowercased(),
        label: String,
        workspaceID: String,
        workspace: String,
        name: String,
        launch: TerminalLaunch,
        backend: Backend = .machinenSession,
        workingDirectory: String,
        sshHost: String? = nil,
        state: State = .starting,
        activityState: ActivityState = .unknown,
        titleOverride: String? = nil
    ) {
        self.id = id
        self.tileID = tileID
        self.label = label
        self.workspaceID = workspaceID
        self.workspace = workspace
        self.name = name
        self.launch = launch
        self.backend = backend
        location = sshHost.map { .ssh(host: $0, path: workingDirectory) }
            ?? .local(workingDirectory)
        self.state = state
        self.activityState = activityState
        self.titleOverride = titleOverride
        observedCommand = nil
        inferredShellName = nil
        runtimeLabel = nil
        shellPID = nil
        processPID = nil
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case tileID
        case label
        case workspaceID
        case workspace
        case name
        case launch
        case backend
        case command
        case workingDirectory
        case location
        case state
        case activityState
        case titleOverride
        case runtimeLabel
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
        // Manifests written before the session backend existed refer to live
        // dtach sockets. Preserve those processes until the user explicitly
        // restarts them; new TerminalSession values use machinen-session.
        backend = try container.decodeIfPresent(Backend.self, forKey: .backend) ?? .dtach
        if let decoded = try container.decodeIfPresent(WorkspaceLocation.self, forKey: .location) {
            location = decoded
        } else {
            location = .local(try container.decode(String.self, forKey: .workingDirectory))
        }
        state = try container.decode(State.self, forKey: .state)
        activityState = try container.decodeIfPresent(ActivityState.self, forKey: .activityState) ?? .unknown
        titleOverride = try container.decodeIfPresent(String.self, forKey: .titleOverride)
        observedCommand = nil
        inferredShellName = nil
        runtimeLabel = try container.decodeIfPresent(String.self, forKey: .runtimeLabel)
        shellPID = nil
        processPID = nil
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
        try container.encode(backend, forKey: .backend)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encode(location, forKey: .location)
        try container.encode(state, forKey: .state)
        try container.encode(activityState, forKey: .activityState)
        try container.encodeIfPresent(titleOverride, forKey: .titleOverride)
        try container.encodeIfPresent(runtimeLabel, forKey: .runtimeLabel)
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
            if backend == .dtach {
                "Viewer detached.\n\nThe process continues behind dtach socket:\n\(socketPath)"
            } else {
                "Viewer detached.\n\nThe process continues in Machinen session \(id)\(location.sshHost.map { " on \($0)" } ?? "")."
            }
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
