import Darwin
import Foundation

struct TerminalGeometry: Decodable, Equatable, Sendable {
    let columns: UInt32
    let rows: UInt32
    let generation: UInt32
    let ownerClientId: UInt64?
}

struct TerminalTelemetry: Decodable, Sendable {
    let activity: TerminalSession.ActivityState
    let shellPid: Int32?
    let processPid: Int32?
    let shellName: String?
    let command: String?
    let geometry: TerminalGeometry?

    init(
        activity: TerminalSession.ActivityState,
        shellPid: Int32?,
        processPid: Int32?,
        shellName: String?,
        command: String?,
        geometry: TerminalGeometry? = nil
    ) {
        self.activity = activity
        self.shellPid = shellPid
        self.processPid = processPid
        self.shellName = shellName
        self.command = command
        self.geometry = geometry
    }

    private enum CodingKeys: String, CodingKey {
        case activity, shellPid, processPid, shellName, command
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            activity: try container.decode(
                TerminalSession.ActivityState.self,
                forKey: .activity
            ),
            shellPid: try container.decodeIfPresent(Int32.self, forKey: .shellPid),
            processPid: try container.decodeIfPresent(Int32.self, forKey: .processPid),
            shellName: try container.decodeIfPresent(String.self, forKey: .shellName),
            command: try container.decodeIfPresent(String.self, forKey: .command)
        )
    }
}

private struct TerminalTelemetryEnvelope: Decodable, Sendable {
    let telemetry: TerminalTelemetry
    let geometry: TerminalGeometry?
}

struct AttachedTerminalClient: Decodable, Equatable, Sendable {
    let id: UInt64
    let name: String
    let pid: Int32?
    let connectedAtMs: Int64
    let writer: Bool
    let resize: Bool
    let readOnly: Bool
}

struct AvailableTerminalSession: Decodable, Equatable, Sendable {
    let id: String
    let name: String?
    let state: String
    let workspaceId: String?
    let workingDirectory: String
    let clientControlAvailable: Bool
    let clients: [AttachedTerminalClient]
    let createdAtMs: Int64
    let updatedAtMs: Int64

    init(
        id: String,
        name: String?,
        state: String,
        workspaceId: String?,
        workingDirectory: String,
        clientControlAvailable: Bool = false,
        clients: [AttachedTerminalClient] = [],
        createdAtMs: Int64,
        updatedAtMs: Int64
    ) {
        self.id = id
        self.name = name
        self.state = state
        self.workspaceId = workspaceId
        self.workingDirectory = workingDirectory
        self.clientControlAvailable = clientControlAvailable
        self.clients = clients
        self.createdAtMs = createdAtMs
        self.updatedAtMs = updatedAtMs
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, state, workspaceId, workingDirectory
        case clientControlAvailable, clients, createdAtMs, updatedAtMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        state = try container.decode(String.self, forKey: .state)
        workspaceId = try container.decodeIfPresent(String.self, forKey: .workspaceId)
        workingDirectory = try container.decode(String.self, forKey: .workingDirectory)
        clientControlAvailable = try container.decodeIfPresent(
            Bool.self,
            forKey: .clientControlAvailable
        ) ?? false
        clients = try container.decodeIfPresent(
            [AttachedTerminalClient].self,
            forKey: .clients
        ) ?? []
        createdAtMs = try container.decode(Int64.self, forKey: .createdAtMs)
        updatedAtMs = try container.decode(Int64.self, forKey: .updatedAtMs)
    }
}

struct NativeWorkspaceRecord: Decodable, Equatable, Sendable {
    let id: String
    let name: String
    let rootDirectory: String
    let createdAtMs: Int64
    let updatedAtMs: Int64
}

struct TerminalViewerLaunch: Sendable {
    let executable: String
    let arguments: [String]
    let environment: [String]?
    let executableName: String
    let workingDirectory: String
}

@MainActor
protocol TerminalSessionBackend: AnyObject {
    func prepareViewer(
        for session: TerminalSession,
        loginShell: String,
        completion: @escaping @MainActor @Sendable (Result<TerminalViewerLaunch, Error>) -> Void
    )
    func send(_ data: Data, to session: TerminalSession) -> Bool
    func inspect(
        _ session: TerminalSession,
        completion: @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
    )
    func listSessions(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[AvailableTerminalSession], Error>) -> Void
    )
    func listWorkspaces(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[NativeWorkspaceRecord], Error>) -> Void
    )
    func saveWorkspace(
        id: String,
        name: String,
        at location: WorkspaceLocation,
        sessionIDs: [String],
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    )
    func deleteWorkspace(
        id: String,
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    )
    func takeControl(
        of session: TerminalSession,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    )
    func resize(_ session: TerminalSession, columns: UInt16, rows: UInt16) -> Bool
    func resizeAsync(
        _ session: TerminalSession,
        columns: UInt16,
        rows: UInt16,
        completion: @escaping @MainActor @Sendable (Bool) -> Void
    )
    func signal(_ signal: String, session: TerminalSession)
    func stop(_ session: TerminalSession)
    func reset(_ session: TerminalSession)
    func remove(_ session: TerminalSession)
}

@MainActor
enum TerminalSessionBackendFactory {
    private static let machinenSession = MachinenNativeSessionBackend()

    static var backend: any TerminalSessionBackend {
        machinenSession
    }
}

private struct BackendProcessResult: Sendable {
    let status: Int32
    let output: String
}

private struct TerminalControlInvocation: Sendable {
    let executable: String
    let arguments: [String]
}

enum MachinenSSHTransport {
    static let executable = "/usr/bin/ssh"

    private static let controlPath: String? = {
        let directory = "/tmp/machinen-\(getuid())"
        do {
            try FileManager.default.createDirectory(
                atPath: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let attributes = try FileManager.default.attributesOfItem(atPath: directory)
            guard attributes[.type] as? FileAttributeType == .typeDirectory,
                  (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid()
            else { return nil }
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: directory
            )
            return directory + "/ssh-%C"
        } catch {
            return nil
        }
    }()

    static func arguments(connectTimeout: Int? = nil) -> [String] {
        var result = ["-o", "BatchMode=yes"]
        if let controlPath {
            result += [
                "-o", "ControlMaster=auto",
                "-o", "ControlPersist=60",
                "-o", "ControlPath=\(controlPath)",
            ]
        }
        if let connectTimeout {
            result += ["-o", "ConnectTimeout=\(connectTimeout)"]
        }
        return result
    }
}

private enum TerminalSessionControl {
    private static let cleanupQueue = DispatchQueue(
        label: "dev.machinen.session-cleanup",
        qos: .utility,
        attributes: .concurrent
    )

    static func run(_ invocation: TerminalControlInvocation) -> Bool {
        (try? TerminalSessionCommand.run(
            executable: invocation.executable,
            arguments: invocation.arguments
        ).status) == 0
    }

    static func remove(
        stop: TerminalControlInvocation,
        delete: TerminalControlInvocation,
        kill: TerminalControlInvocation
    ) {
        _ = run(stop)
        Thread.sleep(forTimeInterval: 0.3)
        guard !run(delete) else { return }
        // A shell may trap SIGHUP. Explicit removal is stronger than stop,
        // so force the process group down before one final metadata pass.
        _ = run(kill)
        Thread.sleep(forTimeInterval: 0.1)
        _ = run(delete)
    }

    static func removeAsync(
        stop: TerminalControlInvocation,
        delete: TerminalControlInvocation,
        kill: TerminalControlInvocation
    ) {
        cleanupQueue.async {
            remove(stop: stop, delete: delete, kill: kill)
        }
    }
}

private enum TerminalSessionBackendError: LocalizedError, Sendable {
    case helperUnavailable(String)
    case commandFailed(String)
    case invalidLaunch

    var errorDescription: String? {
        switch self {
        case let .helperUnavailable(path):
            "The Machinen session helper is unavailable at \(path)"
        case let .commandFailed(message):
            message
        case .invalidLaunch:
            "The terminal launch definition is invalid"
        }
    }
}

private enum TerminalSessionCommand {
    static func run(
        executable: String,
        arguments: [String],
        input: Data? = nil,
        environment: [String: String]? = nil
    ) throws -> BackendProcessResult {
        let task = Process()
        let output = Pipe()
        let inputPipe = Pipe()
        task.executableURL = URL(fileURLWithPath: executable)
        task.arguments = arguments
        task.standardOutput = output
        task.standardError = output
        task.standardInput = input == nil ? FileHandle.nullDevice : inputPipe
        task.environment = environment
        try task.run()
        if let input {
            inputPipe.fileHandleForWriting.write(input)
            try? inputPipe.fileHandleForWriting.close()
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        return BackendProcessResult(
            status: task.terminationStatus,
            output: String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
}

@MainActor
final class MachinenNativeSessionBackend: TerminalSessionBackend {
    private struct NativeSessionList: Decodable {
        let sessions: [AvailableTerminalSession]
    }

    private struct NativeWorkspaceList: Decodable {
        let workspaces: [NativeWorkspaceRecord]
    }

    private enum StorePreparation: Sendable {
        case remote(host: String)
        case local(helper: String, database: String)
    }

    private struct RemoteViewerLaunches: Sendable {
        let darwin: TerminalViewerLaunch
        let xdg: TerminalViewerLaunch
    }

    private enum ViewerPreparation: Sendable {
        case remote(
            host: String,
            sessionID: String,
            newCommand: String,
            launches: RemoteViewerLaunches
        )
        case local(
            helper: String,
            database: String,
            sessionID: String,
            newArguments: [String],
            environment: [String: String]?,
            launch: TerminalViewerLaunch
        )
        case remoteAttach(
            host: String,
            sessionID: String,
            launches: RemoteViewerLaunches
        )
        case localAttach(launch: TerminalViewerLaunch)
    }

    private actor ViewerPreparer {
        private var installedSSHHosts: Set<String> = []

        func prepare(_ preparation: ViewerPreparation) throws -> TerminalViewerLaunch {
            switch preparation {
            case let .remote(host, sessionID, newCommand, launches):
                try ensureRemoteHelper(on: host)
                let result = try MachinenNativeSessionBackend.runSSH(
                    host: host,
                    command: newCommand
                )
                if result.status != 0,
                   try !MachinenNativeSessionBackend.remoteSessionExists(
                       sessionID,
                       host: host
                   )
                {
                    throw TerminalSessionBackendError.commandFailed(
                        result.output.isEmpty
                            ? "Could not create the remote terminal session"
                            : result.output
                    )
                }
                return try remoteLaunch(
                    host: host,
                    sessionID: sessionID,
                    launches: launches
                )
            case let .local(
                helper,
                database,
                sessionID,
                newArguments,
                environment,
                launch
            ):
                let result = try TerminalSessionCommand.run(
                    executable: helper,
                    arguments: newArguments,
                    environment: environment
                )
                if result.status != 0,
                   try !MachinenNativeSessionBackend.localSessionExists(
                       sessionID,
                       helper: helper,
                       database: database
                   )
                {
                    throw TerminalSessionBackendError.commandFailed(
                        result.output.isEmpty
                            ? "Could not create the terminal session"
                            : result.output
                    )
                }
                return launch
            case let .remoteAttach(host, sessionID, launches):
                try ensureRemoteHelper(on: host)
                return try remoteLaunch(
                    host: host,
                    sessionID: sessionID,
                    launches: launches
                )
            case let .localAttach(launch):
                return launch
            }
        }

        private func remoteLaunch(
            host: String,
            sessionID: String,
            launches: RemoteViewerLaunches
        ) throws -> TerminalViewerLaunch {
            let result = try MachinenNativeSessionBackend.runSSH(
                host: host,
                command: MachinenNativeSessionBackend.remoteDatabaseKindCommand(
                    sessionID: sessionID
                )
            )
            guard result.status == 0 else {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty
                        ? "Could not locate the remote terminal session"
                        : result.output
                )
            }
            switch result.output {
            case "darwin": return launches.darwin
            case "xdg": return launches.xdg
            default:
                throw TerminalSessionBackendError.commandFailed(
                    "The remote terminal session returned an invalid database location"
                )
            }
        }

        func list(_ preparation: StorePreparation) throws -> [AvailableTerminalSession] {
            let result: BackendProcessResult
            switch preparation {
            case let .remote(host):
                try ensureRemoteHelper(on: host)
                result = try MachinenNativeSessionBackend.runSSH(
                    host: host,
                    command: MachinenNativeSessionBackend.remoteListCommand()
                )
            case let .local(helper, database):
                result = try TerminalSessionCommand.run(
                    executable: helper,
                    arguments: ["list", "--database", database]
                )
            }
            guard result.status == 0 else {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty ? "Could not list terminal sessions" : result.output
                )
            }
            return try MachinenNativeSessionBackend.decodeSessionListOutput(result.output)
        }

        func listWorkspaces(_ preparation: StorePreparation) throws -> [NativeWorkspaceRecord] {
            let result: BackendProcessResult
            switch preparation {
            case let .remote(host):
                try ensureRemoteHelper(on: host)
                result = try MachinenNativeSessionBackend.runSSH(
                    host: host,
                    command: MachinenNativeSessionBackend.remoteWorkspaceListCommand()
                )
            case let .local(helper, database):
                result = try TerminalSessionCommand.run(
                    executable: helper,
                    arguments: ["workspace", "list", "--database", database]
                )
            }
            guard result.status == 0, let data = result.output.data(using: .utf8) else {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty ? "Could not list workspaces" : result.output
                )
            }
            return try JSONDecoder().decode(NativeWorkspaceList.self, from: data).workspaces
        }

        func saveWorkspace(
            _ preparation: StorePreparation,
            id: String,
            name: String,
            root: String,
            sessionIDs: [String]
        ) throws {
            let result: BackendProcessResult
            switch preparation {
            case let .remote(host):
                try ensureRemoteHelper(on: host)
                result = try MachinenNativeSessionBackend.runSSH(
                    host: host,
                    command: MachinenNativeSessionBackend.remoteWorkspaceSaveCommand(
                        id: id,
                        name: name,
                        root: root,
                        sessionIDs: sessionIDs
                    )
                )
            case let .local(helper, database):
                result = try TerminalSessionCommand.run(
                    executable: helper,
                    arguments: MachinenNativeSessionBackend.workspaceSaveArguments(
                        database: database,
                        id: id,
                        name: name,
                        root: root,
                        sessionIDs: sessionIDs
                    )
                )
            }
            guard result.status == 0 else {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty ? "Could not save workspace" : result.output
                )
            }
        }

        func deleteWorkspace(_ preparation: StorePreparation, id: String) throws {
            let result: BackendProcessResult
            switch preparation {
            case let .remote(host):
                try ensureRemoteHelper(on: host)
                result = try MachinenNativeSessionBackend.runSSH(
                    host: host,
                    command: MachinenNativeSessionBackend.remoteWorkspaceDeleteCommand(id: id)
                )
            case let .local(helper, database):
                result = try TerminalSessionCommand.run(
                    executable: helper,
                    arguments: ["workspace", "delete", "--database", database, id]
                )
            }
            guard result.status == 0 else {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty ? "Could not delete workspace" : result.output
                )
            }
        }

        private func ensureRemoteHelper(on host: String) throws {
            if installedSSHHosts.contains(host) { return }
            let version = try MachinenNativeSessionBackend.runSSH(
                host: host,
                command: "test -x \"$HOME/.local/bin/machinen-session\" && "
                    + "\"$HOME/.local/bin/machinen-session\" --version"
            )
            if version.status != 0 || version.output != MachinenBuildVersions.sessionHandler {
                let helperURL = try MachinenNativeSessionBackend.remoteHelperURL(host: host)
                guard let data = try? Data(contentsOf: helperURL), !data.isEmpty else {
                    throw TerminalSessionBackendError.helperUnavailable(helperURL.path)
                }
                let install = try MachinenNativeSessionBackend.runSSH(
                    host: host,
                    command: "umask 077; mkdir -p \"$HOME/.local/bin\" "
                        + "\"$HOME/.local/state/machinen\"; "
                        + "tmp=\"$HOME/.local/bin/.machinen-session.$$\"; "
                        + "cat > \"$tmp\" && chmod 700 \"$tmp\" && "
                        + "mv -f \"$tmp\" \"$HOME/.local/bin/machinen-session\"",
                    input: data
                )
                guard install.status == 0 else {
                    throw TerminalSessionBackendError.commandFailed(
                        install.output.isEmpty
                            ? "Could not install machinen-session on \(host)"
                            : install.output
                    )
                }
            }
            installedSSHHosts.insert(host)
        }
    }

    private let viewerPreparer = ViewerPreparer()

    func prepareViewer(
        for session: TerminalSession,
        loginShell: String,
        completion: @escaping @MainActor @Sendable (Result<TerminalViewerLaunch, Error>) -> Void
    ) {
        let preparation: ViewerPreparation
        do {
            preparation = try viewerPreparation(for: session, loginShell: loginShell)
        } catch {
            completion(.failure(error))
            return
        }
        let viewerPreparer = viewerPreparer
        Task { @MainActor in
            do {
                completion(.success(try await viewerPreparer.prepare(preparation)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func viewerPreparation(
        for session: TerminalSession,
        loginShell: String
    ) throws -> ViewerPreparation {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if let host = session.location.sshHost {
            let launches = RemoteViewerLaunches(
                darwin: Self.remoteViewerLaunch(
                    session: session,
                    host: host,
                    home: home,
                    database: "$HOME/Library/Application Support/Machinen/sessions.sqlite3"
                ),
                xdg: Self.remoteViewerLaunch(
                    session: session,
                    host: host,
                    home: home,
                    database: "$HOME/.local/state/machinen/sessions.sqlite3"
                )
            )
            guard session.startsSessionIfMissing else {
                return .remoteAttach(
                    host: host,
                    sessionID: session.id,
                    launches: launches
                )
            }
            return .remote(
                host: host,
                sessionID: session.id,
                newCommand: try Self.remoteNewCommand(for: session),
                launches: launches
            )
        }

        let helper = Self.sessionExecutablePath()
        guard FileManager.default.isExecutableFile(atPath: helper) else {
            throw TerminalSessionBackendError.helperUnavailable(helper)
        }
        let database = try Self.localDatabasePath()
        let launch = TerminalViewerLaunch(
            executable: helper,
            arguments: [
                "attach", "--database", database,
                "--latest-screen", "--geometry-events",
                "--client-id", String(session.viewerClientID),
                "--client-name", Self.desktopClientName(),
                session.id,
            ],
            environment: nil,
            executableName: "machinen-session",
            workingDirectory: home
        )
        guard session.startsSessionIfMissing else {
            return .localAttach(launch: launch)
        }
        let command = try Self.localLaunchCommand(for: session.launch, loginShell: loginShell)
        return .local(
            helper: helper,
            database: database,
            sessionID: session.id,
            newArguments: Self.newArguments(
                database: database,
                session: session,
                command: command
            ),
            environment: Self.localProcessEnvironment(session.launch.environment),
            launch: launch
        )
    }

    func send(_ data: Data, to session: TerminalSession) -> Bool {
        guard !data.isEmpty else { return false }
        do {
            if let host = session.location.sshHost {
                return try Self.runSSH(
                    host: host,
                    command: Self.remoteControlCommand("send", sessionID: session.id),
                    input: data
                ).status == 0
            }
            let result = try TerminalSessionCommand.run(
                executable: Self.sessionExecutablePath(),
                arguments: ["send", "--database", Self.localDatabasePath(), session.id],
                input: data
            )
            return result.status == 0
        } catch {
            return false
        }
    }

    func inspect(
        _ session: TerminalSession,
        completion: @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
    ) {
        let executable: String
        let arguments: [String]
        do {
            if let host = session.location.sshHost {
                executable = MachinenSSHTransport.executable
                arguments = MachinenSSHTransport.arguments(connectTimeout: 5) + [
                    host,
                    Self.remoteControlCommand("inspect", sessionID: session.id),
                ]
            } else {
                executable = Self.sessionExecutablePath()
                arguments = ["inspect", "--database", try Self.localDatabasePath(), session.id]
            }
        } catch {
            completion(nil)
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let result = try? TerminalSessionCommand.run(
                executable: executable,
                arguments: arguments
            )
            let telemetry = result.flatMap { result -> TerminalTelemetry? in
                guard result.status == 0, let data = result.output.data(using: .utf8),
                      let envelope = try? JSONDecoder().decode(
                          TerminalTelemetryEnvelope.self,
                          from: data
                      )
                else { return nil }
                return TerminalTelemetry(
                    activity: envelope.telemetry.activity,
                    shellPid: envelope.telemetry.shellPid,
                    processPid: envelope.telemetry.processPid,
                    shellName: envelope.telemetry.shellName,
                    command: envelope.telemetry.command,
                    geometry: envelope.geometry
                )
            }
            DispatchQueue.main.async { completion(telemetry) }
        }
    }

    private func storePreparation(for location: WorkspaceLocation) throws -> StorePreparation {
        if let host = location.sshHost { return .remote(host: host) }
        let helper = Self.sessionExecutablePath()
        guard FileManager.default.isExecutableFile(atPath: helper) else {
            throw TerminalSessionBackendError.helperUnavailable(helper)
        }
        return .local(helper: helper, database: try Self.localDatabasePath())
    }

    func listSessions(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[AvailableTerminalSession], Error>) -> Void
    ) {
        let preparation: StorePreparation
        do {
            preparation = try storePreparation(for: location)
        } catch {
            completion(.failure(error))
            return
        }
        let viewerPreparer = viewerPreparer
        Task { @MainActor in
            do {
                completion(.success(try await viewerPreparer.list(preparation)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func listWorkspaces(
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<[NativeWorkspaceRecord], Error>) -> Void
    ) {
        let preparation: StorePreparation
        do {
            preparation = try storePreparation(for: location)
        } catch {
            completion(.failure(error))
            return
        }
        let viewerPreparer = viewerPreparer
        Task { @MainActor in
            do {
                completion(.success(try await viewerPreparer.listWorkspaces(preparation)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func saveWorkspace(
        id: String,
        name: String,
        at location: WorkspaceLocation,
        sessionIDs: [String],
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        let preparation: StorePreparation
        do {
            preparation = try storePreparation(for: location)
        } catch {
            completion(.failure(error))
            return
        }
        let viewerPreparer = viewerPreparer
        let root = location.path
        Task { @MainActor in
            do {
                try await viewerPreparer.saveWorkspace(
                    preparation,
                    id: id,
                    name: name,
                    root: root,
                    sessionIDs: sessionIDs
                )
                completion(.success(()))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func deleteWorkspace(
        id: String,
        at location: WorkspaceLocation,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        let preparation: StorePreparation
        do {
            preparation = try storePreparation(for: location)
        } catch {
            completion(.failure(error))
            return
        }
        let viewerPreparer = viewerPreparer
        Task { @MainActor in
            do {
                try await viewerPreparer.deleteWorkspace(preparation, id: id)
                completion(.success(()))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func takeControl(
        of session: TerminalSession,
        completion: @escaping @MainActor @Sendable (Result<Void, Error>) -> Void
    ) {
        guard let invocation = controlInvocation(
            "take",
            session: session,
            trailingArguments: ["--client-id", String(session.viewerClientID)]
        ) else {
            completion(.failure(TerminalSessionBackendError.commandFailed(
                "Could not prepare the take-control request"
            )))
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let result = try? TerminalSessionCommand.run(
                executable: invocation.executable,
                arguments: invocation.arguments
            )
            DispatchQueue.main.async {
                guard let result, result.status == 0 else {
                    let message = result.flatMap { $0.output.isEmpty ? nil : $0.output }
                        ?? "Could not take control of the terminal session"
                    completion(.failure(TerminalSessionBackendError.commandFailed(message)))
                    return
                }
                completion(.success(()))
            }
        }
    }

    func resize(_ session: TerminalSession, columns: UInt16, rows: UInt16) -> Bool {
        guard columns > 0, rows > 0,
              let invocation = controlInvocation(
                  "resize",
                  session: session,
                  trailingArguments: [
                      "--columns", String(columns),
                      "--rows", String(rows),
                  ]
              )
        else { return false }
        return TerminalSessionControl.run(invocation)
    }

    func resizeAsync(
        _ session: TerminalSession,
        columns: UInt16,
        rows: UInt16,
        completion: @escaping @MainActor @Sendable (Bool) -> Void
    ) {
        guard columns > 0, rows > 0,
              let invocation = controlInvocation(
                  "resize",
                  session: session,
                  trailingArguments: [
                      "--columns", String(columns),
                      "--rows", String(rows),
                  ]
              )
        else {
            completion(false)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let succeeded = TerminalSessionControl.run(invocation)
            DispatchQueue.main.async { completion(succeeded) }
        }
    }

    func signal(_ signal: String, session: TerminalSession) {
        guard ["interrupt", "hangup", "terminate", "kill"].contains(signal) else { return }
        if let host = session.location.sshHost {
            _ = try? Self.runSSH(
                host: host,
                command: Self.remoteControlCommand(
                    "signal",
                    sessionID: session.id,
                    trailingArguments: [signal]
                )
            )
        } else if let database = try? Self.localDatabasePath() {
            _ = try? TerminalSessionCommand.run(
                executable: Self.sessionExecutablePath(),
                arguments: ["signal", "--database", database, session.id, signal]
            )
        }
    }

    func stop(_ session: TerminalSession) {
        runControl("stop", session: session)
    }

    func reset(_ session: TerminalSession) {
        guard let invocations = removalInvocations(for: session) else { return }
        TerminalSessionControl.remove(
            stop: invocations.stop,
            delete: invocations.delete,
            kill: invocations.kill
        )
    }

    func remove(_ session: TerminalSession) {
        guard let invocations = removalInvocations(for: session) else { return }
        TerminalSessionControl.removeAsync(
            stop: invocations.stop,
            delete: invocations.delete,
            kill: invocations.kill
        )
    }

    private func removalInvocations(
        for session: TerminalSession
    ) -> (
        stop: TerminalControlInvocation,
        delete: TerminalControlInvocation,
        kill: TerminalControlInvocation
    )? {
        guard let stop = controlInvocation("stop", session: session),
              let delete = controlInvocation("delete", session: session),
              let kill = controlInvocation(
                  "signal",
                  session: session,
                  trailingArguments: ["kill"]
              )
        else { return nil }
        return (stop, delete, kill)
    }

    @discardableResult
    private func runControl(_ operation: String, session: TerminalSession) -> Bool {
        guard let invocation = controlInvocation(operation, session: session) else { return false }
        return TerminalSessionControl.run(invocation)
    }

    private func controlInvocation(
        _ operation: String,
        session: TerminalSession,
        trailingArguments: [String] = []
    ) -> TerminalControlInvocation? {
        if let host = session.location.sshHost {
            return TerminalControlInvocation(
                executable: MachinenSSHTransport.executable,
                arguments: MachinenSSHTransport.arguments(connectTimeout: 8) + [
                    host,
                    Self.remoteControlCommand(
                        operation,
                        sessionID: session.id,
                        trailingArguments: trailingArguments
                    ),
                ]
            )
        }
        guard let database = try? Self.localDatabasePath() else { return nil }
        return TerminalControlInvocation(
            executable: Self.sessionExecutablePath(),
            arguments: [operation, "--database", database, session.id] + trailingArguments
        )
    }

    nonisolated static func decodeSessionListOutput(
        _ output: String
    ) throws -> [AvailableTerminalSession] {
        let lines = output.split(whereSeparator: \.isNewline)
        guard !lines.isEmpty else {
            throw TerminalSessionBackendError.commandFailed(
                "The terminal session list was empty"
            )
        }
        var sessions: [AvailableTerminalSession] = []
        var seenIDs = Set<String>()
        for line in lines {
            let decoded = try JSONDecoder().decode(
                NativeSessionList.self,
                from: Data(line.utf8)
            )
            for session in decoded.sessions where seenIDs.insert(session.id).inserted {
                sessions.append(session)
            }
        }
        return sessions
    }

    nonisolated private static func localSessionExists(
        _ id: String,
        helper: String,
        database: String
    ) throws -> Bool {
        let result = try TerminalSessionCommand.run(
            executable: helper,
            arguments: ["list", "--database", database]
        )
        guard result.status == 0, let data = result.output.data(using: .utf8) else { return false }
        return try JSONDecoder().decode(NativeSessionList.self, from: data)
            .sessions.contains { $0.id == id }
    }

    nonisolated private static func remoteSessionExists(
        _ id: String,
        host: String
    ) throws -> Bool {
        let result = try Self.runSSH(host: host, command: Self.remoteListCommand())
        guard result.status == 0, let data = result.output.data(using: .utf8) else { return false }
        return try JSONDecoder().decode(NativeSessionList.self, from: data)
            .sessions.contains { $0.id == id }
    }

    nonisolated private static func remoteHelperURL(host: String) throws -> URL {
        let platform = try runSSH(
            host: host,
            command: "printf '%s %s' \"$(uname -s)\" \"$(uname -m)\""
        )
        guard platform.status == 0 else {
            throw TerminalSessionBackendError.commandFailed(
                platform.output.isEmpty ? "Could not detect the platform on \(host)" : platform.output
            )
        }
        let helperName: String
        switch platform.output {
        case "Darwin arm64", "Darwin aarch64":
            helperName = "machinen-session"
        case "Linux arm64", "Linux aarch64":
            helperName = "machinen-session-aarch64-linux"
        case "Linux x86_64", "Linux amd64":
            helperName = "machinen-session-x86_64-linux"
        default:
            throw TerminalSessionBackendError.commandFailed(
                "machinen-session does not support remote platform \(platform.output)"
            )
        }
        return Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/\(helperName)")
    }

    private static func localDatabasePath() throws -> String {
        let environment = ProcessInfo.processInfo.environment
        let root: URL
        if let override = environment["MACHINEN_STATE_DIR"], !override.isEmpty {
            root = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            root = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            )[0].appendingPathComponent("Machinen", isDirectory: true)
        }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent("sessions.sqlite3").path
    }

    private static func sessionExecutablePath() -> String {
        let bundled = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/machinen-session").path
        if FileManager.default.isExecutableFile(atPath: bundled) {
            return bundled
        }
        return URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
            .appendingPathComponent("machinen-session").path
    }

    private static func newArguments(
        database: String,
        session: TerminalSession,
        command: [String]
    ) -> [String] {
        [
            "new", "--database", database,
            "--id", session.id,
            "--workspace-id", session.workspaceID,
            "--workspace-name", session.workspace,
            "--workspace-root", session.workspaceRoot,
            "--cwd", session.workingDirectory,
            "--",
        ] + command
    }

    private static func localLaunchCommand(
        for launch: TerminalLaunch,
        loginShell: String
    ) throws -> [String] {
        switch launch.kind {
        case .loginShell:
            return [loginShell, "-l"]
        case .shellCommand:
            return [loginShell, "-lc", launch.command ?? ""]
        case .exec:
            guard let executable = launch.executable, !executable.isEmpty else {
                throw TerminalSessionBackendError.invalidLaunch
            }
            return [executable] + (launch.arguments ?? [])
        }
    }

    private static func remoteLaunchCommand(for launch: TerminalLaunch) throws -> [String] {
        switch launch.kind {
        case .loginShell:
            return ["/bin/sh", "-lc", "exec \"${SHELL:-/bin/sh}\" -l"]
        case .shellCommand:
            return [
                "/bin/sh", "-lc",
                "exec \"${SHELL:-/bin/sh}\" -lc "
                    + WorkspaceLocation.shellQuote(launch.command ?? ""),
            ]
        case .exec:
            guard let executable = launch.executable, !executable.isEmpty else {
                throw TerminalSessionBackendError.invalidLaunch
            }
            var command: [String] = []
            if let environment = launch.environment, !environment.isEmpty {
                command.append("/usr/bin/env")
                command.append(contentsOf: environment.sorted(by: { $0.key < $1.key }).map {
                    "\($0.key)=\($0.value)"
                })
            }
            command.append(executable)
            command.append(contentsOf: launch.arguments ?? [])
            return command
        }
    }

    static func remoteNewCommand(for session: TerminalSession) throws -> String {
        let command = try remoteLaunchCommand(for: session.launch)
        let arguments = [
            "new", "--database", "$MACHINEN_SESSION_DATABASE",
            "--id", session.id,
            "--workspace-id", session.workspaceID,
            "--workspace-name", session.workspace,
            "--workspace-root", session.workspaceRoot,
            "--cwd", session.workingDirectory,
            "--",
        ] + command
        return remoteResolvedSessionCommand(arguments, sessionID: session.id)
    }

    private static func remoteViewerLaunch(
        session: TerminalSession,
        host: String,
        home: String,
        database: String
    ) -> TerminalViewerLaunch {
        TerminalViewerLaunch(
            executable: MachinenSSHTransport.executable,
            arguments: MachinenSSHTransport.arguments() + [
                "-t", host,
                remoteAttachCommand(session: session, database: database),
            ],
            environment: nil,
            executableName: "ssh",
            workingDirectory: home
        )
    }

    private static func remoteAttachCommand(
        session: TerminalSession,
        database: String
    ) -> String {
        let arguments = [
            "attach", "--database", database, session.id,
            "--latest-screen", "--geometry-events",
            "--client-id", String(session.viewerClientID),
            "--client-name", desktopClientName(),
        ]
        return "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    nonisolated private static func desktopClientName() -> String {
        let host = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
        var name = "Machinen Desktop on \(host)".filter {
            !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        }
        while name.utf8.count > 127 { name.removeLast() }
        return name
    }

    nonisolated private static func remoteListCommand() -> String {
        remoteAllSessionDatabasesCommand([
            "list", "--database", "$MACHINEN_SESSION_DATABASE",
        ])
    }

    nonisolated private static func workspaceSaveArguments(
        database: String,
        id: String,
        name: String,
        root: String,
        sessionIDs: [String]
    ) -> [String] {
        var arguments = [
            "workspace", "save", "--database", database,
            "--id", id,
            "--name", name,
            "--root", root,
        ]
        for sessionID in sessionIDs { arguments += ["--session", sessionID] }
        return arguments
    }

    nonisolated private static func remoteWorkspaceListCommand() -> String {
        remoteCanonicalSessionCommand([
            "workspace", "list", "--database", "$MACHINEN_SESSION_DATABASE",
        ])
    }

    nonisolated private static func remoteWorkspaceSaveCommand(
        id: String,
        name: String,
        root: String,
        sessionIDs: [String]
    ) -> String {
        remoteAllSessionDatabasesCommand(workspaceSaveArguments(
            database: "$MACHINEN_SESSION_DATABASE",
            id: id,
            name: name,
            root: root,
            sessionIDs: sessionIDs
        ))
    }

    nonisolated private static func remoteWorkspaceDeleteCommand(id: String) -> String {
        remoteAllSessionDatabasesCommand([
            "workspace", "delete", "--database", "$MACHINEN_SESSION_DATABASE", id,
        ])
    }

    private static func remoteControlCommand(
        _ operation: String,
        sessionID: String,
        trailingArguments: [String] = []
    ) -> String {
        remoteResolvedSessionCommand([
            operation, "--database", "$MACHINEN_SESSION_DATABASE", sessionID,
        ] + trailingArguments, sessionID: sessionID)
    }

    nonisolated private static func remoteDatabaseKindCommand(
        sessionID: String
    ) -> String {
        let helper = "\"$HOME/.local/bin/machinen-session\""
        let sessionID = remoteArgument(sessionID)
        return "if [ \"$(uname -s)\" = 'Darwin' ]; then "
            + "d=\"$HOME/Library/Application Support/Machinen/sessions.sqlite3\"; "
            + "if \(helper) inspect --database \"$d\" \(sessionID) >/dev/null 2>&1; "
            + "then printf darwin; exit 0; fi; fi; printf xdg"
    }

    nonisolated private static func remoteResolvedSessionCommand(
        _ arguments: [String],
        sessionID: String
    ) -> String {
        let helper = "\"$HOME/.local/bin/machinen-session\""
        let quotedSessionID = remoteArgument(sessionID)
        let selectExistingDatabase = "if [ -n \"$MACHINEN_LEGACY_SESSION_DATABASE\" ] "
            + "&& [ -f \"$MACHINEN_LEGACY_SESSION_DATABASE\" ] "
            + "&& ! \(helper) inspect --database \"$MACHINEN_SESSION_DATABASE\" "
            + "\(quotedSessionID) >/dev/null 2>&1 "
            + "&& \(helper) inspect --database \"$MACHINEN_LEGACY_SESSION_DATABASE\" "
            + "\(quotedSessionID) >/dev/null 2>&1; then "
            + "MACHINEN_SESSION_DATABASE=\"$MACHINEN_LEGACY_SESSION_DATABASE\"; fi; "
        return remoteDatabaseSetup() + selectExistingDatabase
            + helper + " " + arguments.map(remoteArgument).joined(separator: " ")
    }

    nonisolated private static func remoteCanonicalSessionCommand(
        _ arguments: [String]
    ) -> String {
        remoteDatabaseSetup() + "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    nonisolated private static func remoteAllSessionDatabasesCommand(
        _ arguments: [String]
    ) -> String {
        let helper = "\"$HOME/.local/bin/machinen-session\""
        let canonical = helper + " "
            + arguments.map(remoteArgument).joined(separator: " ")
        let legacyArguments = arguments.map {
            $0 == "$MACHINEN_SESSION_DATABASE"
                ? "$MACHINEN_LEGACY_SESSION_DATABASE"
                : $0
        }
        let legacy = helper + " "
            + legacyArguments.map(remoteArgument).joined(separator: " ")
        return remoteDatabaseSetup() + canonical + " || exit $?; "
            + "if [ -n \"$MACHINEN_LEGACY_SESSION_DATABASE\" ] "
            + "&& [ -f \"$MACHINEN_LEGACY_SESSION_DATABASE\" ]; then "
            + legacy + "; fi"
    }

    nonisolated private static func remoteDatabaseSetup() -> String {
        "if [ \"$(uname -s)\" = 'Darwin' ]; then "
            + "MACHINEN_SESSION_DATABASE=\"$HOME/Library/Application Support/Machinen/sessions.sqlite3\"; "
            + "MACHINEN_LEGACY_SESSION_DATABASE=\"${XDG_STATE_HOME:-$HOME/.local/state}/machinen/sessions.sqlite3\"; "
            + "else MACHINEN_SESSION_DATABASE=\"${XDG_STATE_HOME:-$HOME/.local/state}/machinen/sessions.sqlite3\"; "
            + "MACHINEN_LEGACY_SESSION_DATABASE=''; fi; "
            + "mkdir -p \"${MACHINEN_SESSION_DATABASE%/*}\"; "
    }

    nonisolated private static func remoteArgument(_ value: String) -> String {
        if value.hasPrefix("$HOME/")
            || value == "$MACHINEN_SESSION_DATABASE"
            || value == "$MACHINEN_LEGACY_SESSION_DATABASE"
            || value.hasPrefix("${XDG_STATE_HOME:")
        {
            return "\"\(value)\""
        }
        return WorkspaceLocation.shellQuote(value)
    }

    private static func localProcessEnvironment(_ additions: [String: String]?) -> [String: String]? {
        guard let additions, !additions.isEmpty else { return nil }
        var environment = ProcessInfo.processInfo.environment
        environment.merge(additions) { _, new in new }
        return environment
    }

    nonisolated private static func runSSH(
        host: String,
        command: String,
        input: Data? = nil
    ) throws -> BackendProcessResult {
        try TerminalSessionCommand.run(
            executable: MachinenSSHTransport.executable,
            arguments: MachinenSSHTransport.arguments(connectTimeout: 8) + [host, command],
            input: input
        )
    }
}
