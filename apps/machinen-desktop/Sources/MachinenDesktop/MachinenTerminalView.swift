import AppKit
import SwiftTerm

/// A SwiftTerm viewer attached to a persistent terminal-session backend.
///
/// New and restarted terminals use Machinen's native session worker. Sessions
/// decoded from older manifests keep using the bundled dtach compatibility
/// backend until restart, so deploying an update never interrupts live work.
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
    private var attachAfterClientExit = false
    private var attachRetryScheduled = false
    private var pendingRenderBytes: [UInt8] = []
    private var pendingRenderTimer: Timer?
    private var inputBoostTimer: Timer?
    private var isFocusedRendering = false
    private var renderInterval = RenderCadence.thumbnail
    private var terminalBackend: any TerminalSessionBackend {
        TerminalSessionBackendFactory.backend(for: session.backend)
    }

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
        if process.running {
            // Detach and immediate reattach can overlap while the old attach
            // process is still restoring terminal mode. End that viewer and
            // retry instead of leaving the tile permanently in `starting`.
            if session.state == .starting {
                attachAfterClientExit = true
                terminate()
                clientStarted = false
                scheduleAttachRetry()
            }
            return
        }
        if clientStarted {
            // startProcess has been requested but LocalProcess has not yet
            // published `running`. Wait for that launch rather than starting
            // a second attach process against the same SwiftTerm view.
            if session.state == .starting {
                attachAfterClientExit = true
                scheduleAttachRetry()
            }
            return
        }
        attachAfterClientExit = false
        attachRetryScheduled = false
        clientStarted = true
        requestedStateAfterExit = nil
        session.state = .starting
        onStateChange?(.starting)

        do {
            let launch = try terminalBackend.prepareViewer(
                for: session,
                loginShell: loginShell()
            )
            startProcess(
                executable: launch.executable,
                args: launch.arguments,
                environment: launch.environment,
                execName: launch.executableName,
                currentDirectory: launch.workingDirectory
            )
            session.state = .running
            onStateChange?(.running)
        } catch {
            InputRoutingLog.log(
                "terminal[\(session.tileID)] backend=\(session.backend.rawValue) failed: \(error.localizedDescription)"
            )
            clientStarted = false
            session.state = .stopped
            onStateChange?(.stopped)
        }
    }

    private func scheduleAttachRetry() {
        guard !attachRetryScheduled else { return }
        attachRetryScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { return }
            self.attachRetryScheduled = false
            if self.session.state == .starting { self.attach() }
        }
    }

    func detachForApplicationExit() {
        guard process.running else { return }
        attachAfterClientExit = false
        requestedStateAfterExit = .running
        terminate()
    }

    func detachViewer() {
        attachAfterClientExit = false
        guard process.running else {
            session.state = .detached
            onStateChange?(.detached)
            return
        }
        requestedStateAfterExit = .detached
        terminate()
        // SwiftTerm's explicit terminate path cancels its process monitor and
        // does not call processTerminated, so release our launch guard here.
        clientStarted = false
    }

    @discardableResult
    func sendPersistentInput(_ data: Data) -> Bool {
        guard !data.isEmpty,
              session.state == .running || session.state == .starting || session.state == .detached
        else { return false }
        return terminalBackend.send(data, to: session)
    }

    func signalPersistentSession(_ signal: String) {
        terminalBackend.signal(signal, session: session)
    }

    func stopPersistentSession() {
        attachAfterClientExit = false
        requestedStateAfterExit = .stopped
        terminalBackend.stop(session)
        session.state = .stopped
        onStateChange?(.stopped)
    }

    func removePersistentSession() {
        requestedStateAfterExit = .stopped
        terminalBackend.remove(session)
    }

    func restartPersistentSession() {
        requestedStateAfterExit = .stopped
        terminalBackend.reset(session)
        // Legacy persisted terminals keep their dtach process until an explicit
        // restart, at which point this session moves to the native backend.
        session.backend = .machinenSession
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
        let shouldReattach = attachAfterClientExit
        attachAfterClientExit = false
        let nextState: TerminalSession.State = shouldReattach
            ? .starting
            : requestedStateAfterExit ?? .exited
        requestedStateAfterExit = nil
        session.state = nextState
        onStateChange?(nextState)
        if shouldReattach {
            DispatchQueue.main.async { [weak self] in self?.attach() }
        }
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

    static func remoteCommand(
        for launch: TerminalLaunch,
        workingDirectory: String
    ) -> String? {
        let location = WorkspaceLocation.ssh(host: "remote", path: workingDirectory)
        let prefix = "cd -- \(location.remoteShellPath) && exec "
        switch launch.kind {
        case .loginShell:
            return prefix + "\"${SHELL:-/bin/sh}\" -l"
        case .shellCommand:
            return prefix + "\"${SHELL:-/bin/sh}\" -lc "
                + WorkspaceLocation.shellQuote(launch.command ?? "")
        case .exec:
            guard let executable = launch.executable, !executable.isEmpty else { return nil }
            var command: [String] = []
            if let environment = launch.environment, !environment.isEmpty {
                command.append("/usr/bin/env")
                command.append(contentsOf: environment.sorted(by: { $0.key < $1.key }).map {
                    WorkspaceLocation.shellQuote("\($0.key)=\($0.value)")
                })
            }
            command.append(WorkspaceLocation.shellQuote(executable))
            command.append(contentsOf: (launch.arguments ?? []).map(WorkspaceLocation.shellQuote))
            return prefix + command.joined(separator: " ")
        }
    }

    private func loginShell() -> String {
        ProcessInfo.processInfo.environment["SHELL"].flatMap {
            FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil
        } ?? "/bin/zsh"
    }

}
