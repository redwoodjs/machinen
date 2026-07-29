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
    static let backendName = "machinenSession"

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
    /// Directory root used to recover the workspace from the native session store.
    /// It is distinct from a terminal's launch directory and live OSC 7 directory.
    var workspaceRoot: String
    /// False for a native session discovered outside Desktop. Reconnection may
    /// attach to it, but Desktop must not invent a replacement command if the
    /// worker disappears.
    var startsSessionIfMissing: Bool
    var location: WorkspaceLocation
    var workingDirectory: String {
        get { location.path }
        set { location.path = newValue }
    }
    /// The most recent directory reported by OSC 7. Unlike `workingDirectory`,
    /// this follows an interactive shell after `cd`.
    var currentWorkingDirectory: String?

    var effectiveWorkingDirectory: String {
        currentWorkingDirectory ?? workingDirectory
    }

    var effectiveLocation: WorkspaceLocation {
        var result = location
        result.path = effectiveWorkingDirectory
        return result
    }

    var state: State
    var activityState: ActivityState
    var titleOverride: String?
    /// Disconnecting removes the tile while leaving its native session alive.
    /// These fields preserve availability and the former workspace position.
    var disconnectedAt: Date?
    var disconnectedPosition: Int?
    var observedCommand: String?
    /// Runtime-only name of the login shell, inferred from live process metadata.
    /// It is deliberately not persisted or allowed to replace a user-given name.
    var inferredShellName: String?
    /// A runtime label intentionally sent by the program inside the terminal.
    /// It takes precedence over the inferred shell name until cleared.
    var runtimeLabel: String?
    /// Best-effort live process identifiers. They are never persisted because
    /// a restarted process gets new PIDs.
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
        workingDirectory: String,
        workspaceRoot: String? = nil,
        sshHost: String? = nil,
        startsSessionIfMissing: Bool = true,
        state: State = .starting,
        activityState: ActivityState = .unknown,
        titleOverride: String? = nil,
        disconnectedAt: Date? = nil,
        disconnectedPosition: Int? = nil
    ) {
        self.id = id
        self.tileID = tileID
        self.label = label
        self.workspaceID = workspaceID
        self.workspace = workspace
        self.name = name
        self.launch = launch
        self.workspaceRoot = workspaceRoot ?? workingDirectory
        self.startsSessionIfMissing = startsSessionIfMissing
        location = sshHost.map { .ssh(host: $0, path: workingDirectory) }
            ?? .local(workingDirectory)
        self.state = state
        self.activityState = activityState
        self.titleOverride = titleOverride
        currentWorkingDirectory = nil
        self.disconnectedAt = disconnectedAt
        self.disconnectedPosition = disconnectedPosition
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
        case workspaceRoot
        case startsSessionIfMissing
        case backend
        case command
        case workingDirectory
        case currentWorkingDirectory
        case location
        case state
        case activityState
        case titleOverride
        case disconnectedAt
        case disconnectedPosition
        // Migration keys from the former five-minute close buffer.
        case pendingCloseDeadline
        case pendingClosePosition
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
        startsSessionIfMissing = try container.decodeIfPresent(
            Bool.self,
            forKey: .startsSessionIfMissing
        ) ?? true
        let persistedBackend = try container.decodeIfPresent(String.self, forKey: .backend)
        if let decoded = try container.decodeIfPresent(WorkspaceLocation.self, forKey: .location) {
            location = decoded
        } else {
            location = .local(try container.decode(String.self, forKey: .workingDirectory))
        }
        workspaceRoot = try container.decodeIfPresent(String.self, forKey: .workspaceRoot)
            ?? location.path
        let persistedState = try container.decode(State.self, forKey: .state)
        // A pre-native prototype manifest cannot identify a Machinen session
        // worker. Keep its launch definition, but require an explicit restart.
        state = persistedBackend == Self.backendName ? persistedState : .stopped
        let persistedActivity = try container.decodeIfPresent(
            ActivityState.self,
            forKey: .activityState
        ) ?? .unknown
        activityState = persistedBackend == Self.backendName ? persistedActivity : .unknown
        titleOverride = try container.decodeIfPresent(String.self, forKey: .titleOverride)
        currentWorkingDirectory = try container.decodeIfPresent(
            String.self,
            forKey: .currentWorkingDirectory
        )
        let legacyCloseDeadline = try container.decodeIfPresent(
            Date.self,
            forKey: .pendingCloseDeadline
        )
        disconnectedAt = try container.decodeIfPresent(Date.self, forKey: .disconnectedAt)
            ?? legacyCloseDeadline.map { min($0, Date()) }
        disconnectedPosition = try container.decodeIfPresent(Int.self, forKey: .disconnectedPosition)
            ?? container.decodeIfPresent(Int.self, forKey: .pendingClosePosition)
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
        try container.encode(workspaceRoot, forKey: .workspaceRoot)
        try container.encode(startsSessionIfMissing, forKey: .startsSessionIfMissing)
        try container.encode(Self.backendName, forKey: .backend)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encode(location, forKey: .location)
        try container.encodeIfPresent(currentWorkingDirectory, forKey: .currentWorkingDirectory)
        try container.encode(state, forKey: .state)
        try container.encode(activityState, forKey: .activityState)
        try container.encodeIfPresent(titleOverride, forKey: .titleOverride)
        try container.encodeIfPresent(disconnectedAt, forKey: .disconnectedAt)
        try container.encodeIfPresent(disconnectedPosition, forKey: .disconnectedPosition)
        try container.encodeIfPresent(runtimeLabel, forKey: .runtimeLabel)
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
            "Viewer detached.\n\nThe process continues in Machinen session \(id)\(location.sshHost.map { " on \($0)" } ?? "")."
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
    var workspaceLocationHistory: [WorkspaceLocation]

    init(
        workspaces: [WorkspaceRecord],
        sessions: [TerminalSession],
        workspaceLocationHistory: [WorkspaceLocation]? = nil
    ) {
        self.workspaces = workspaces
        self.sessions = sessions
        self.workspaceLocationHistory = workspaceLocationHistory ?? workspaces.map(\.location)
    }
}
