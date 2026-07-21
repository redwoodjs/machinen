import AppKit
import SwiftTerm

/// A persistent terminal viewer backed by Machinen's bundled dtach helper.
///
/// The local SwiftTerm PTY runs a transparent dtach client. The dtach master
/// owns the user's command, so closing or relaunching Machinen only detaches a
/// viewer; it does not terminate the command or intercept terminal input.
final class MachinenTerminalView: LocalProcessTerminalView {
    let session: TerminalSession

    var onStateChange: ((TerminalSession.State) -> Void)?
    var onActivityChange: ((TerminalSession.ActivityState) -> Void)?
    var onCommandChange: ((String) -> Void)?
    var onOutput: ((Data) -> Void)?

    private var clientStarted = false
    private var activityDetector: TerminalActivityDetector?
    private var requestedStateAfterExit: TerminalSession.State?

    init(session: TerminalSession) {
        self.session = session
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.105, alpha: 1).cgColor

        // CoreText keeps transferable builds independent of Xcode's offline
        // Metal compiler. The host boundary allows a renderer swap later.
        try? setUseMetal(false)
        nativeForegroundColor = NSColor(calibratedWhite: 0.82, alpha: 1)
        nativeBackgroundColor = NSColor(calibratedWhite: 0.105, alpha: 1)
        caretColor = NSColor(calibratedWhite: 0.92, alpha: 1)
        getTerminal().setCursorStyle(.steadyBlock)
        let detector = TerminalActivityDetector(session: session)
        detector.onActivityChange = { [weak self] state in
            self?.onActivityChange?(state)
        }
        detector.onCommandChange = { [weak self] command in
            self?.onCommandChange?(command)
        }
        activityDetector = detector
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil else {
            activityDetector?.stop()
            return
        }
        activityDetector?.start()
        if session.state == .running || session.state == .starting || session.state == .disconnected {
            attach()
        }
    }

    func attach() {
        guard !process.running, !clientStarted else { return }
        clientStarted = true
        requestedStateAfterExit = nil
        session.state = .starting
        onStateChange?(.starting)

        var arguments = ["-A", session.socketPath, "-E", "-z", "-r", "winch"]
        var environment: [String]?
        switch session.launch.kind {
        case .loginShell:
            arguments.append(contentsOf: [loginShell(), "-l"])
        case .shellCommand:
            arguments.append(contentsOf: [loginShell(), "-lc", session.launch.command ?? ""])
        case .exec:
            guard let executable = session.launch.executable, !executable.isEmpty else {
                clientStarted = false
                session.state = .stopped
                onStateChange?(.stopped)
                return
            }
            arguments.append(executable)
            arguments.append(contentsOf: session.launch.arguments ?? [])
            if let additions = session.launch.environment {
                var merged = ProcessInfo.processInfo.environment
                merged.merge(additions) { _, new in new }
                environment = merged.map { "\($0.key)=\($0.value)" }
            }
        }
        startProcess(
            executable: dtachExecutablePath(),
            args: arguments,
            environment: environment,
            execName: "machinen-dtach",
            currentDirectory: session.workingDirectory
        )
        session.state = .running
        onStateChange?(.running)
    }

    func detachForApplicationExit() {
        guard process.running else { return }
        requestedStateAfterExit = .running
        terminate()
    }

    func detachViewer() {
        guard process.running else {
            session.state = .detached
            onStateChange?(.detached)
            return
        }
        requestedStateAfterExit = .detached
        terminate()
    }

    @discardableResult
    func sendPersistentInput(_ data: Data) -> Bool {
        guard !data.isEmpty,
              session.state == .running || session.state == .starting || session.state == .detached
        else { return false }
        let task = Process()
        let input = Pipe()
        task.executableURL = URL(fileURLWithPath: dtachExecutablePath())
        task.arguments = ["-p", session.socketPath]
        task.standardInput = input
        do {
            try task.run()
            input.fileHandleForWriting.write(data)
            try input.fileHandleForWriting.close()
            return true
        } catch {
            return false
        }
    }

    func signalPersistentSession(_ signal: String) {
        if signal == "interrupt" {
            _ = sendPersistentInput(Data([0x03]))
            return
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-\(signal)", "-f", session.socketPath]
        try? task.run()
    }

    func stopPersistentSession() {
        requestedStateAfterExit = .stopped
        stopDtachSession()
        session.state = .stopped
        onStateChange?(.stopped)
    }

    func restartPersistentSession() {
        requestedStateAfterExit = .stopped
        stopDtachSession()
        clientStarted = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            guard let self else { return }
            self.requestedStateAfterExit = nil
            self.attach()
        }
    }

    override func dataReceived(slice: ArraySlice<UInt8>) {
        super.dataReceived(slice: slice)
        activityDetector?.recordOutput()
        onOutput?(Data(slice))
    }

    override func processTerminated(_ source: LocalProcess, exitCode: Int32?) {
        super.processTerminated(source, exitCode: exitCode)
        clientStarted = false
        let nextState = requestedStateAfterExit ?? .exited
        requestedStateAfterExit = nil
        session.state = nextState
        onStateChange?(nextState)
    }

    private func loginShell() -> String {
        ProcessInfo.processInfo.environment["SHELL"].flatMap {
            FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil
        } ?? "/bin/zsh"
    }

    private func dtachExecutablePath() -> String {
        let bundled = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/machinen-dtach").path
        if FileManager.default.isExecutableFile(atPath: bundled) {
            return bundled
        }
        let adjacent = URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
            .appendingPathComponent("machinen-dtach").path
        return adjacent
    }

    private func stopDtachSession() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-f", session.socketPath]
        try? task.run()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [socketPath = session.socketPath] in
            try? FileManager.default.removeItem(atPath: socketPath)
        }
    }
}
