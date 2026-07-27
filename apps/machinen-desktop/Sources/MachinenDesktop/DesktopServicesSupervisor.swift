import Foundation

@MainActor
final class DesktopServicesSupervisor {
    private static let stableRunDuration: TimeInterval = 30
    private static let maximumRestartDelay: TimeInterval = 30

    private let executableURL: URL
    private let arguments: [String]
    private let currentDirectoryURL: URL?
    private let environment: [String: String]
    private let restartBaseDelay: TimeInterval

    private var process: Process?
    private var inputPipe: Pipe?
    private var restartTask: Task<Void, Never>?
    private var startedAt: Date?
    private var consecutiveFailures = 0
    private var isStopped = true

    static func bundled(apiSocketPath: String, bundle: Bundle = .main) -> DesktopServicesSupervisor? {
        let executableURL = bundle.bundleURL
            .appendingPathComponent("Contents/Helpers/node", isDirectory: false)
        guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            NSLog("Machinen Desktop services are unavailable: bundled Node runtime is missing")
            return nil
        }
        guard let resourceURL = bundle.resourceURL else {
            NSLog("Machinen Desktop services are unavailable: bundle resources are missing")
            return nil
        }
        let servicesDirectory = resourceURL.appendingPathComponent("DesktopServices", isDirectory: true)
        let scriptURL = servicesDirectory.appendingPathComponent("index.js", isDirectory: false)
        guard FileManager.default.isReadableFile(atPath: scriptURL.path) else {
            NSLog("Machinen Desktop services are unavailable: service bundle is missing")
            return nil
        }

        var environment = ProcessInfo.processInfo.environment
        environment["MACHINEN_API_SOCKET"] = apiSocketPath
        environment["MACHINEN_DESKTOP_SUPERVISED"] = "1"
        return DesktopServicesSupervisor(
            executableURL: executableURL,
            arguments: [scriptURL.path],
            currentDirectoryURL: servicesDirectory,
            environment: environment
        )
    }

    init(
        executableURL: URL,
        arguments: [String],
        currentDirectoryURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        restartBaseDelay: TimeInterval = 1
    ) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.currentDirectoryURL = currentDirectoryURL
        self.environment = environment
        self.restartBaseDelay = restartBaseDelay
    }

    func start() {
        guard isStopped else { return }
        isStopped = false
        launch()
    }

    func stop() {
        guard !isStopped else { return }
        isStopped = true
        restartTask?.cancel()
        restartTask = nil
        inputPipe?.fileHandleForWriting.closeFile()
        inputPipe = nil
        let runningProcess = process
        process = nil
        runningProcess?.terminationHandler = nil
        if runningProcess?.isRunning == true {
            runningProcess?.terminate()
        }
    }

    private func launch() {
        guard !isStopped, process == nil else { return }
        let child = Process()
        let childInput = Pipe()
        child.executableURL = executableURL
        child.arguments = arguments
        child.currentDirectoryURL = currentDirectoryURL
        child.environment = environment
        child.standardInput = childInput
        child.standardOutput = FileHandle.standardError
        child.standardError = FileHandle.standardError
        child.terminationHandler = { [weak self, weak child] _ in
            guard let child else { return }
            Task { @MainActor [weak self] in
                self?.processExited(child)
            }
        }

        do {
            try child.run()
            process = child
            inputPipe = childInput
            startedAt = Date()
            childInput.fileHandleForReading.closeFile()
            NSLog("Machinen Desktop services started (pid %d)", child.processIdentifier)
        } catch {
            childInput.fileHandleForReading.closeFile()
            childInput.fileHandleForWriting.closeFile()
            NSLog("Machinen Desktop services could not start: %@", String(describing: error))
            scheduleRestart()
        }
    }

    private func processExited(_ child: Process) {
        guard process === child else { return }
        let runDuration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        process = nil
        startedAt = nil
        inputPipe?.fileHandleForWriting.closeFile()
        inputPipe = nil
        guard !isStopped else { return }
        if runDuration >= Self.stableRunDuration {
            consecutiveFailures = 0
        }
        NSLog(
            "Machinen Desktop services exited with status %d after %.1f seconds",
            child.terminationStatus,
            runDuration
        )
        scheduleRestart()
    }

    private func scheduleRestart() {
        guard !isStopped, restartTask == nil else { return }
        let exponent = min(consecutiveFailures, 5)
        let delay = min(
            Self.maximumRestartDelay,
            restartBaseDelay * pow(2, Double(exponent))
        )
        consecutiveFailures += 1
        restartTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
            guard let self, !self.isStopped else { return }
            self.restartTask = nil
            self.launch()
        }
    }
}
