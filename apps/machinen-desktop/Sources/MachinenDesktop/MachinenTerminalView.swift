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
    var onShellNameChange: ((String) -> Void)?
    var onProcessInfoChange: ((TerminalProcessInfo?) -> Void)?
    var onRuntimeLabelChange: ((String?) -> Void)?
    var onOutput: ((Data) -> Void)?

    private enum RenderCadence {
        static let focusedPassive: TimeInterval = 1.0 / 20.0
        static let interactive: TimeInterval = 1.0 / 60.0
        static let thumbnail: TimeInterval = 1.0 / 12.0
        static let inputBoostDuration: TimeInterval = 0.15
    }

    private var clientStarted = false
    private var activityDetector: TerminalActivityDetector?
    private var requestedStateAfterExit: TerminalSession.State?
    private var pendingRenderBytes: [UInt8] = []
    private var pendingRenderTimer: Timer?
    private var inputBoostTimer: Timer?
    private var isFocusedRendering = false
    private var renderInterval = RenderCadence.thumbnail

    init(session: TerminalSession) {
        self.session = session
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.105, alpha: 1).cgColor

        // SwiftTerm's experimental Metal path still shapes each row on CPU and
        // was slower than CoreText in the spatial multi-viewer profile. Keep
        // CoreText, then coalesce refreshes below at a deliberate cadence.
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
        detector.onShellNameChange = { [weak self] shellName in
            self?.onShellNameChange?(shellName)
        }
        detector.onProcessInfoChange = { [weak self] info in
            self?.onProcessInfoChange?(info)
        }
        activityDetector = detector
    }

    /// Programs inside the terminal can set a Machinen-specific runtime label
    /// with OSC 2, for example: `ESC ] 2 ; machinen:agent BEL`. OSC survives
    /// SSH hops, unlike Machinen's local Unix socket.
    override func setTerminalTitle(source: TerminalView, title: String) {
        super.setTerminalTitle(source: source, title: title)
        guard let label = Self.runtimeLabel(fromTerminalTitle: title) else { return }
        InputRoutingLog.log("terminal[\(session.tileID)] runtime label=\(label ?? "<cleared>")")
        onRuntimeLabelChange?(label)
    }

    static func runtimeLabel(fromTerminalTitle title: String) -> String?? {
        guard title.hasPrefix("machinen:") else { return nil }
        let label = String(title.dropFirst("machinen:".count))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard label.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              label.count <= 80
        else { return nil }
        return label.isEmpty ? .some(nil) : .some(label)
    }

    override func mouseDown(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseDown \(InputRoutingLog.event(event))")
        super.mouseDown(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseDragged \(InputRoutingLog.event(event))")
        super.mouseDragged(with: event)
    }

    override func mouseUp(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseUp \(InputRoutingLog.event(event))")
        super.mouseUp(with: event)
    }

    override func copy(_ sender: Any) {
        InputRoutingLog.log("terminal[\(session.tileID)] copy")
        super.copy(sender)
    }

    override func paste(_ sender: Any) {
        InputRoutingLog.log("terminal[\(session.tileID)] paste")
        super.paste(sender)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// SwiftTerm's legacy control-key path maps letters and punctuation only,
    /// which drops `⌃↩` entirely. In a legacy terminal, Control-Return has the
    /// same byte-level meaning as Control-M: carriage return. Applications that
    /// enable the Kitty keyboard protocol retain their distinct modified-Enter
    /// sequence through SwiftTerm's native handling.
    static func legacyControlReturnBytes(
        keyCode: UInt16,
        modifiers: NSEvent.ModifierFlags,
        kittyKeyboardEnabled: Bool
    ) -> [UInt8]? {
        guard !kittyKeyboardEnabled,
              modifiers.contains(.control),
              keyCode == 36 || keyCode == 76
        else { return nil }
        return [0x0D]
    }

    @discardableResult
    func sendLegacyControlReturn() -> Bool {
        guard getTerminal().keyboardEnhancementFlags.isEmpty else { return false }
        return sendPersistentInput(Data([0x0D]))
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

    /// Full-size terminals stream at 20 Hz until local input arrives, then
    /// receive a brief 60 Hz burst. Spatial thumbnails remain live at 12 Hz.
    /// Bytes are still observed and published immediately.
    func setFocusedRendering(_ focused: Bool) {
        isFocusedRendering = focused
        inputBoostTimer?.invalidate()
        inputBoostTimer = nil
        setRenderInterval(focused ? RenderCadence.focusedPassive : RenderCadence.thumbnail, flush: focused)
    }

    func boostRenderingForLocalInput() {
        guard isFocusedRendering else { return }
        inputBoostTimer?.invalidate()
        setRenderInterval(RenderCadence.interactive, flush: true)
        inputBoostTimer = Timer.scheduledTimer(
            withTimeInterval: RenderCadence.inputBoostDuration,
            repeats: false
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isFocusedRendering else { return }
                self.setRenderInterval(RenderCadence.focusedPassive, flush: false)
            }
        }
    }

    override func dataReceived(slice: ArraySlice<UInt8>) {
        activityDetector?.recordOutput()
        onOutput?(Data(slice))
        pendingRenderBytes.append(contentsOf: slice)
        schedulePendingRender()
    }

    override func processTerminated(_ source: LocalProcess, exitCode: Int32?) {
        flushPendingRender()
        super.processTerminated(source, exitCode: exitCode)
        clientStarted = false
        let nextState = requestedStateAfterExit ?? .exited
        requestedStateAfterExit = nil
        session.state = nextState
        onStateChange?(nextState)
    }

    private func setRenderInterval(_ interval: TimeInterval, flush: Bool) {
        guard renderInterval != interval else {
            if flush { flushPendingRender() }
            return
        }
        renderInterval = interval
        if flush { flushPendingRender() }
    }

    private func schedulePendingRender() {
        guard pendingRenderTimer == nil else { return }
        let timer = Timer.scheduledTimer(withTimeInterval: renderInterval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.flushPendingRender()
            }
        }
        pendingRenderTimer = timer
    }

    private func flushPendingRender() {
        pendingRenderTimer?.invalidate()
        pendingRenderTimer = nil
        guard !pendingRenderBytes.isEmpty else { return }
        let bytes = pendingRenderBytes
        pendingRenderBytes.removeAll(keepingCapacity: true)
        super.dataReceived(slice: bytes[...])
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
