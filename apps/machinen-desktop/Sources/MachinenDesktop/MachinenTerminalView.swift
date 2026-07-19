import AppKit
import SwiftTerm

/// A persistent terminal viewer backed by Machinen's bundled dtach helper.
///
/// The local SwiftTerm PTY runs a transparent dtach client. The dtach master
/// owns the user's command, so closing or relaunching Machinen only detaches a
/// viewer; it does not terminate the command or intercept terminal input.
final class MachinenTerminalView: LocalProcessTerminalView {
    let session: TerminalSession

    var onDoubleEscape: (() -> Void)?
    var onStateChange: ((TerminalSession.State) -> Void)?

    private var clientStarted = false
    private var requestedStateAfterExit: TerminalSession.State?
    private var previousEscapeTime: TimeInterval?
    nonisolated(unsafe) private var keyEventMonitor: Any?

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
        keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.filterKeyDown(event) ?? event
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        if let keyEventMonitor {
            NSEvent.removeMonitor(keyEventMonitor)
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil else { return }
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

        let shell = loginShell()
        var arguments = ["-A", session.socketPath, "-E", "-z", "-r", "winch"]
        if let command = session.command, !command.isEmpty {
            arguments.append(contentsOf: [shell, "-lc", command])
        } else {
            arguments.append(contentsOf: [shell, "-l"])
        }
        startProcess(
            executable: dtachExecutablePath(),
            args: arguments,
            environment: nil,
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

    override func processTerminated(_ source: LocalProcess, exitCode: Int32?) {
        super.processTerminated(source, exitCode: exitCode)
        clientStarted = false
        let nextState = requestedStateAfterExit ?? .stopped
        requestedStateAfterExit = nil
        session.state = nextState
        onStateChange?(nextState)
    }

    private func filterKeyDown(_ event: NSEvent) -> NSEvent? {
        guard event.window === window, window?.firstResponder === self else { return event }
        if event.keyCode == 53 {
            let now = ProcessInfo.processInfo.systemUptime
            if let previousEscapeTime, now - previousEscapeTime <= 0.45 {
                self.previousEscapeTime = nil
                onDoubleEscape?()
                return nil
            }
            previousEscapeTime = now
        } else {
            previousEscapeTime = nil
        }
        return event
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
