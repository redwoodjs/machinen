import Darwin
import Foundation

struct TerminalTelemetry: Decodable, Sendable {
    let activity: TerminalSession.ActivityState
    let shellPid: Int32?
    let processPid: Int32?
    let shellName: String?
    let command: String?
}

private struct TerminalTelemetryEnvelope: Decodable, Sendable {
    let telemetry: TerminalTelemetry
}

struct AvailableTerminalSession: Decodable, Equatable, Sendable {
    let id: String
    let name: String?
    let state: String
    let workspaceId: String?
    let workingDirectory: String
    let createdAtMs: Int64
    let updatedAtMs: Int64
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
        task.waitUntilExit()
        let data = output.fileHandleForReading.readDataToEndOfFile()
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

    private enum ViewerPreparation: Sendable {
        case remote(
            host: String,
            sessionID: String,
            newCommand: String,
            launch: TerminalViewerLaunch
        )
        case local(
            helper: String,
            database: String,
            sessionID: String,
            newArguments: [String],
            environment: [String: String]?,
            launch: TerminalViewerLaunch
        )
        case remoteAttach(host: String, launch: TerminalViewerLaunch)
        case localAttach(launch: TerminalViewerLaunch)
    }

    private actor ViewerPreparer {
        private var installedSSHHosts: Set<String> = []

        func prepare(_ preparation: ViewerPreparation) throws -> TerminalViewerLaunch {
            switch preparation {
            case let .remote(host, sessionID, newCommand, launch):
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
                return launch
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
            case let .remoteAttach(host, launch):
                try ensureRemoteHelper(on: host)
                return launch
            case let .localAttach(launch):
                return launch
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
            guard result.status == 0, let data = result.output.data(using: .utf8) else {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty ? "Could not list terminal sessions" : result.output
                )
            }
            return try JSONDecoder().decode(NativeSessionList.self, from: data).sessions
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
            if version.status != 0 || version.output != MachinenNativeSessionBackend.helperVersion {
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

    nonisolated private static let helperVersion = "0.5.4"
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
            let launch = TerminalViewerLaunch(
                executable: MachinenSSHTransport.executable,
                arguments: MachinenSSHTransport.arguments() + [
                    "-t", host,
                    Self.remoteAttachCommand(sessionID: session.id),
                ],
                environment: nil,
                executableName: "ssh",
                workingDirectory: home
            )
            guard session.startsSessionIfMissing else {
                return .remoteAttach(host: host, launch: launch)
            }
            return .remote(
                host: host,
                sessionID: session.id,
                newCommand: try Self.remoteNewCommand(for: session),
                launch: launch
            )
        }

        let helper = Self.sessionExecutablePath()
        guard FileManager.default.isExecutableFile(atPath: helper) else {
            throw TerminalSessionBackendError.helperUnavailable(helper)
        }
        let database = try Self.localDatabasePath()
        let launch = TerminalViewerLaunch(
            executable: helper,
            arguments: ["attach", "--database", database, "--latest-screen", session.id],
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
                guard result.status == 0, let data = result.output.data(using: .utf8) else { return nil }
                return try? JSONDecoder().decode(TerminalTelemetryEnvelope.self, from: data).telemetry
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
            "new", "--database", "$HOME/.local/state/machinen/sessions.sqlite3",
            "--id", session.id,
            "--workspace-id", session.workspaceID,
            "--workspace-name", session.workspace,
            "--workspace-root", session.workspaceRoot,
            "--cwd", session.workingDirectory,
            "--",
        ] + command
        return "mkdir -p \"$HOME/.local/state/machinen\" && "
            + "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    private static func remoteAttachCommand(sessionID: String) -> String {
        remoteControlCommand(
            "attach",
            sessionID: sessionID,
            trailingArguments: ["--latest-screen"]
        )
    }

    nonisolated private static func remoteListCommand() -> String {
        "\"$HOME/.local/bin/machinen-session\" list --database "
            + "\"$HOME/.local/state/machinen/sessions.sqlite3\""
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
        "\"$HOME/.local/bin/machinen-session\" workspace list --database "
            + "\"$HOME/.local/state/machinen/sessions.sqlite3\""
    }

    nonisolated private static func remoteWorkspaceSaveCommand(
        id: String,
        name: String,
        root: String,
        sessionIDs: [String]
    ) -> String {
        let arguments = workspaceSaveArguments(
            database: "$HOME/.local/state/machinen/sessions.sqlite3",
            id: id,
            name: name,
            root: root,
            sessionIDs: sessionIDs
        )
        return "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    nonisolated private static func remoteWorkspaceDeleteCommand(id: String) -> String {
        let arguments = [
            "workspace", "delete", "--database",
            "$HOME/.local/state/machinen/sessions.sqlite3", id,
        ]
        return "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    private static func remoteControlCommand(
        _ operation: String,
        sessionID: String,
        trailingArguments: [String] = []
    ) -> String {
        let arguments = [operation, "--database", "$HOME/.local/state/machinen/sessions.sqlite3", sessionID]
            + trailingArguments
        return "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    nonisolated private static func remoteArgument(_ value: String) -> String {
        if value.hasPrefix("$HOME/") {
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
