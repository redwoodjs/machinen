import Foundation

struct TerminalViewerLaunch {
    let executable: String
    let arguments: [String]
    let environment: [String]?
    let executableName: String
    let workingDirectory: String
}

@MainActor
protocol TerminalSessionBackend: AnyObject {
    func prepareViewer(for session: TerminalSession, loginShell: String) throws -> TerminalViewerLaunch
    func send(_ data: Data, to session: TerminalSession) -> Bool
    func signal(_ signal: String, session: TerminalSession)
    func stop(_ session: TerminalSession)
    func reset(_ session: TerminalSession)
    func remove(_ session: TerminalSession)
}

@MainActor
enum TerminalSessionBackendFactory {
    private static let dtach = DtachTerminalSessionBackend()
    private static let machinenSession = MachinenNativeSessionBackend()

    static func backend(for kind: TerminalSession.Backend) -> any TerminalSessionBackend {
        switch kind {
        case .dtach:
            dtach
        case .machinenSession:
            machinenSession
        }
    }
}

private struct BackendProcessResult {
    let status: Int32
    let output: String
}

private enum TerminalSessionBackendError: LocalizedError {
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

@MainActor
private final class DtachTerminalSessionBackend: TerminalSessionBackend {
    func prepareViewer(for session: TerminalSession, loginShell: String) throws -> TerminalViewerLaunch {
        var arguments = ["-A", session.socketPath, "-E", "-z", "-r", "winch"]
        var environment: [String]?
        let localWorkingDirectory: String
        if let host = session.location.sshHost {
            guard let command = MachinenTerminalView.remoteCommand(
                for: session.launch,
                workingDirectory: session.workingDirectory
            ) else { throw TerminalSessionBackendError.invalidLaunch }
            arguments.append(contentsOf: ["/usr/bin/ssh", "-t", host, command])
            localWorkingDirectory = FileManager.default.homeDirectoryForCurrentUser.path
        } else {
            switch session.launch.kind {
            case .loginShell:
                arguments.append(contentsOf: [loginShell, "-l"])
            case .shellCommand:
                arguments.append(contentsOf: [loginShell, "-lc", session.launch.command ?? ""])
            case .exec:
                guard let executable = session.launch.executable, !executable.isEmpty else {
                    throw TerminalSessionBackendError.invalidLaunch
                }
                arguments.append(executable)
                arguments.append(contentsOf: session.launch.arguments ?? [])
                environment = Self.mergedEnvironment(session.launch.environment)
            }
            localWorkingDirectory = session.workingDirectory
        }
        return TerminalViewerLaunch(
            executable: Self.dtachExecutablePath(),
            arguments: arguments,
            environment: environment,
            executableName: "machinen-dtach",
            workingDirectory: localWorkingDirectory
        )
    }

    func send(_ data: Data, to session: TerminalSession) -> Bool {
        guard !data.isEmpty else { return false }
        let result = try? Self.run(
            executable: Self.dtachExecutablePath(),
            arguments: ["-p", session.socketPath],
            input: data
        )
        return result?.status == 0
    }

    func signal(_ signal: String, session: TerminalSession) {
        if signal == "interrupt" {
            _ = send(Data([0x03]), to: session)
            return
        }
        _ = try? Self.run(
            executable: "/usr/bin/pkill",
            arguments: ["-\(signal)", "-f", session.socketPath]
        )
    }

    func stop(_ session: TerminalSession) {
        _ = try? Self.run(
            executable: "/usr/bin/pkill",
            arguments: ["-TERM", "-f", session.socketPath]
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            try? FileManager.default.removeItem(atPath: session.socketPath)
        }
    }

    func reset(_ session: TerminalSession) {
        stop(session)
    }

    func remove(_ session: TerminalSession) {
        stop(session)
    }

    private static func dtachExecutablePath() -> String {
        let bundled = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/machinen-dtach").path
        if FileManager.default.isExecutableFile(atPath: bundled) {
            return bundled
        }
        return URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
            .appendingPathComponent("machinen-dtach").path
    }

    fileprivate static func mergedEnvironment(_ additions: [String: String]?) -> [String]? {
        guard let additions, !additions.isEmpty else { return nil }
        var merged = ProcessInfo.processInfo.environment
        merged.merge(additions) { _, new in new }
        return merged.map { "\($0.key)=\($0.value)" }
    }

    fileprivate static func run(
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
private final class MachinenNativeSessionBackend: TerminalSessionBackend {
    private struct NativeSessionList: Decodable {
        struct Session: Decodable {
            let id: String
            let state: String
        }

        let sessions: [Session]
    }

    private static let helperVersion = "0.3.0"
    private var installedSSHHosts: Set<String> = []

    func prepareViewer(for session: TerminalSession, loginShell: String) throws -> TerminalViewerLaunch {
        if let host = session.location.sshHost {
            try ensureRemoteHelper(on: host)
            let command = try Self.remoteNewCommand(for: session)
            let result = try Self.runSSH(host: host, command: command)
            if result.status != 0, try !remoteSessionExists(session.id, host: host) {
                throw TerminalSessionBackendError.commandFailed(
                    result.output.isEmpty ? "Could not create the remote terminal session" : result.output
                )
            }
            return TerminalViewerLaunch(
                executable: "/usr/bin/ssh",
                arguments: [
                    "-o", "BatchMode=yes",
                    "-t", host,
                    Self.remoteAttachCommand(sessionID: session.id),
                ],
                environment: nil,
                executableName: "ssh",
                workingDirectory: FileManager.default.homeDirectoryForCurrentUser.path
            )
        }

        let helper = Self.sessionExecutablePath()
        guard FileManager.default.isExecutableFile(atPath: helper) else {
            throw TerminalSessionBackendError.helperUnavailable(helper)
        }
        let database = try Self.localDatabasePath()
        let command = try Self.localLaunchCommand(for: session.launch, loginShell: loginShell)
        let environment = Self.localProcessEnvironment(session.launch.environment)
        let result = try DtachTerminalSessionBackend.run(
            executable: helper,
            arguments: Self.newArguments(
                database: database,
                session: session,
                command: command
            ),
            environment: environment
        )
        if result.status != 0, try !localSessionExists(session.id, helper: helper, database: database) {
            throw TerminalSessionBackendError.commandFailed(
                result.output.isEmpty ? "Could not create the terminal session" : result.output
            )
        }
        return TerminalViewerLaunch(
            executable: helper,
            arguments: ["attach", "--database", database, session.id],
            environment: nil,
            executableName: "machinen-session",
            workingDirectory: FileManager.default.homeDirectoryForCurrentUser.path
        )
    }

    func send(_ data: Data, to session: TerminalSession) -> Bool {
        guard !data.isEmpty else { return false }
        do {
            if let host = session.location.sshHost {
                try ensureRemoteHelper(on: host)
                return try Self.runSSH(
                    host: host,
                    command: Self.remoteControlCommand("send", sessionID: session.id),
                    input: data
                ).status == 0
            }
            let result = try DtachTerminalSessionBackend.run(
                executable: Self.sessionExecutablePath(),
                arguments: ["send", "--database", Self.localDatabasePath(), session.id],
                input: data
            )
            return result.status == 0
        } catch {
            return false
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
            _ = try? DtachTerminalSessionBackend.run(
                executable: Self.sessionExecutablePath(),
                arguments: ["signal", "--database", database, session.id, signal]
            )
        }
    }

    func stop(_ session: TerminalSession) {
        runControl("stop", session: session)
    }

    func reset(_ session: TerminalSession) {
        remove(session)
    }

    func remove(_ session: TerminalSession) {
        _ = runControl("stop", session: session)
        Thread.sleep(forTimeInterval: 0.3)
        guard !runControl("delete", session: session) else { return }
        // A shell may trap SIGHUP. Explicit removal is stronger than stop, so
        // force the process group down before making one final metadata pass.
        signal("kill", session: session)
        Thread.sleep(forTimeInterval: 0.1)
        _ = runControl("delete", session: session)
    }

    @discardableResult
    private func runControl(_ operation: String, session: TerminalSession) -> Bool {
        if let host = session.location.sshHost {
            return (try? Self.runSSH(
                host: host,
                command: Self.remoteControlCommand(operation, sessionID: session.id)
            ).status) == 0
        }
        guard let database = try? Self.localDatabasePath() else { return false }
        return (try? DtachTerminalSessionBackend.run(
            executable: Self.sessionExecutablePath(),
            arguments: [operation, "--database", database, session.id]
        ).status) == 0
    }

    private func localSessionExists(_ id: String, helper: String, database: String) throws -> Bool {
        let result = try DtachTerminalSessionBackend.run(
            executable: helper,
            arguments: ["list", "--database", database]
        )
        guard result.status == 0, let data = result.output.data(using: .utf8) else { return false }
        return try JSONDecoder().decode(NativeSessionList.self, from: data)
            .sessions.contains { $0.id == id }
    }

    private func remoteSessionExists(_ id: String, host: String) throws -> Bool {
        let result = try Self.runSSH(host: host, command: Self.remoteListCommand())
        guard result.status == 0, let data = result.output.data(using: .utf8) else { return false }
        return try JSONDecoder().decode(NativeSessionList.self, from: data)
            .sessions.contains { $0.id == id }
    }

    private func ensureRemoteHelper(on host: String) throws {
        if installedSSHHosts.contains(host) { return }
        let version = try Self.runSSH(
            host: host,
            command: "test -x \"$HOME/.local/bin/machinen-session\" && "
                + "\"$HOME/.local/bin/machinen-session\" --version"
        )
        if version.status != 0 || version.output != Self.helperVersion {
            let helperURL = try Self.remoteHelperURL(host: host)
            guard let data = try? Data(contentsOf: helperURL), !data.isEmpty else {
                throw TerminalSessionBackendError.helperUnavailable(helperURL.path)
            }
            let install = try Self.runSSH(
                host: host,
                command: "umask 077; mkdir -p \"$HOME/.local/bin\" \"$HOME/.local/state/machinen\"; "
                    + "tmp=\"$HOME/.local/bin/.machinen-session.$$\"; "
                    + "cat > \"$tmp\" && chmod 700 \"$tmp\" && "
                    + "mv -f \"$tmp\" \"$HOME/.local/bin/machinen-session\"",
                input: data
            )
            guard install.status == 0 else {
                throw TerminalSessionBackendError.commandFailed(
                    install.output.isEmpty ? "Could not install machinen-session on \(host)" : install.output
                )
            }
        }
        installedSSHHosts.insert(host)
    }

    private static func remoteHelperURL(host: String) throws -> URL {
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

    fileprivate static func remoteNewCommand(for session: TerminalSession) throws -> String {
        let command = try remoteLaunchCommand(for: session.launch)
        let arguments = [
            "new", "--database", "$HOME/.local/state/machinen/sessions.sqlite3",
            "--id", session.id,
            "--cwd", session.workingDirectory,
            "--",
        ] + command
        return "mkdir -p \"$HOME/.local/state/machinen\" && "
            + "\"$HOME/.local/bin/machinen-session\" "
            + arguments.map(remoteArgument).joined(separator: " ")
    }

    private static func remoteAttachCommand(sessionID: String) -> String {
        remoteControlCommand("attach", sessionID: sessionID)
    }

    private static func remoteListCommand() -> String {
        "\"$HOME/.local/bin/machinen-session\" list --database "
            + "\"$HOME/.local/state/machinen/sessions.sqlite3\""
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

    private static func remoteArgument(_ value: String) -> String {
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

    private static func runSSH(
        host: String,
        command: String,
        input: Data? = nil
    ) throws -> BackendProcessResult {
        try DtachTerminalSessionBackend.run(
            executable: "/usr/bin/ssh",
            arguments: [
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=8",
                host,
                command,
            ],
            input: input
        )
    }
}
