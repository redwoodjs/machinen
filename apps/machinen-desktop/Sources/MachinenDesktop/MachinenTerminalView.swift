import AppKit
import CoreText
import GhosttyKit

/// An embedded Ghostty surface attached to a persistent Machinen session worker.
final class MachinenTerminalView: NSView, @preconcurrency NSTextInputClient {
    let session: TerminalSession

    var onStateChange: ((TerminalSession.State) -> Void)?
    var onActivityChange: ((TerminalSession.ActivityState) -> Void)?
    var onCommandChange: ((String) -> Void)?
    var onShellNameChange: ((String) -> Void)?
    var onProcessInfoChange: ((TerminalProcessInfo?) -> Void)?
    var onRuntimeLabelChange: ((String?) -> Void)?
    var onOutput: ((Data) -> Void)?

    nonisolated var ghosttySurface: ghostty_surface_t? { surface }

    nonisolated(unsafe) private var surface: ghostty_surface_t?
    private var activityDetector: TerminalActivityDetector?
    private var requestedStateAfterExit: TerminalSession.State?
    private var attachRetryScheduled = false
    private var destroyingSurface = false
    private var terminalInputFocused = false
    private var markedText = NSMutableAttributedString()
    private var keyTextAccumulator: [String]?
    private var cellSize = NSSize(width: 10, height: 20)
    private var tracking: NSTrackingArea?
    private var outputTap: GhosttyOutputTap?
    private var terminalBackend: any TerminalSessionBackend {
        TerminalSessionBackendFactory.backend
    }

    override var acceptsFirstResponder: Bool { true }

    init(
        session: TerminalSession,
        telemetryProvider: ((
            @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
        ) -> Void)? = nil
    ) {
        self.session = session
        super.init(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
        let provider: (
            @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
        ) -> Void
        if let telemetryProvider {
            provider = telemetryProvider
        } else {
            let backend = TerminalSessionBackendFactory.backend
            provider = { completion in backend.inspect(session, completion: completion) }
        }
        let detector = TerminalActivityDetector(session: session, telemetryProvider: provider)
        detector.onActivityChange = { [weak self] state in self?.onActivityChange?(state) }
        detector.onCommandChange = { [weak self] command in self?.onCommandChange?(command) }
        detector.onShellNameChange = { [weak self] shellName in self?.onShellNameChange?(shellName) }
        detector.onProcessInfoChange = { [weak self] info in self?.onProcessInfoChange?(info) }
        activityDetector = detector
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        if let surface { ghostty_surface_free(surface) }
        outputTap?.close()
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

    func startActivityDetection() {
        activityDetector?.start()
    }

    func stopActivityDetection() {
        activityDetector?.stop()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil else { return }
        updateGhosttyGeometry()
        if session.state == .running || session.state == .starting || session.state == .disconnected {
            attach()
        }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        updateGhosttyGeometry()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        updateGhosttyGeometry()
    }

    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(next)
        tracking = next
    }

    func attach() {
        guard surface == nil, !destroyingSurface else {
            if session.state == .starting { scheduleAttachRetry() }
            return
        }
        guard let app = GhosttyRuntime.shared.app else {
            setSessionState(.stopped)
            return
        }

        requestedStateAfterExit = nil
        outputTap?.close()
        outputTap = nil
        setSessionState(.starting)
        do {
            let launch = try terminalBackend.prepareViewer(for: session, loginShell: loginShell())
            let command = commandWithOutputTap(Self.viewerCommand(launch))
            var config = ghostty_surface_config_new()
            config.userdata = Unmanaged.passUnretained(self).toOpaque()
            config.platform_tag = GHOSTTY_PLATFORM_MACOS
            config.platform = ghostty_platform_u(
                macos: ghostty_platform_macos_s(
                    nsview: Unmanaged.passUnretained(self).toOpaque()
                )
            )
            config.scale_factor = Double(
                window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
            )
            config.context = GHOSTTY_SURFACE_CONTEXT_SPLIT

            let created = launch.workingDirectory.withCString { directory in
                config.working_directory = directory
                return command.withCString { commandPointer in
                    config.command = commandPointer
                    return ghostty_surface_new(app, &config)
                }
            }
            guard let created else { throw GhosttyViewError.surfaceCreationFailed }
            surface = created
            updateGhosttyGeometry()
            ghostty_surface_set_focus(created, terminalInputFocused)
            setSessionState(.running)
        } catch {
            outputTap?.close()
            outputTap = nil
            InputRoutingLog.log(
                "terminal[\(session.tileID)] ghostty viewer failed: \(error.localizedDescription)"
            )
            setSessionState(.stopped)
        }
    }

    private static func viewerCommand(_ launch: TerminalViewerLaunch) -> String {
        let arguments = [launch.executable] + launch.arguments
        return arguments.map(WorkspaceLocation.shellQuote).joined(separator: " ")
    }

    private func commandWithOutputTap(_ command: String) -> String {
        do {
            let tap = try GhosttyOutputTap { [weak self] data in
                DispatchQueue.main.async { [weak self] in
                    self?.activityDetector?.recordOutput()
                    self?.onOutput?(data)
                }
            }
            outputTap = tap
            return "\(command) | /usr/bin/tee \(WorkspaceLocation.shellQuote(tap.path))"
        } catch {
            InputRoutingLog.log(
                "terminal[\(session.tileID)] output tap unavailable: \(error.localizedDescription)"
            )
            return command
        }
    }

    private func scheduleAttachRetry() {
        guard !attachRetryScheduled else { return }
        attachRetryScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            guard let self else { return }
            self.attachRetryScheduled = false
            if self.session.state == .starting { self.attach() }
        }
    }

    func detachForApplicationExit() {
        requestedStateAfterExit = .running
        destroyViewer()
    }

    func detachViewer() {
        requestedStateAfterExit = .detached
        destroyViewer()
        setSessionState(.detached)
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
        requestedStateAfterExit = .stopped
        terminalBackend.stop(session)
        destroyViewer()
        setSessionState(.stopped)
    }

    func removePersistentSession() {
        requestedStateAfterExit = .stopped
        destroyViewer()
        terminalBackend.remove(session)
    }

    func restartPersistentSession() {
        requestedStateAfterExit = .stopped
        terminalBackend.reset(session)
        destroyViewer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            guard let self else { return }
            self.requestedStateAfterExit = nil
            self.attach()
        }
    }

    func setTerminalInputFocused(_ focused: Bool) {
        terminalInputFocused = focused
        if let surface { ghostty_surface_set_focus(surface, focused) }
    }

    func ghosttyViewerClosed(processAlive: Bool) {
        guard !destroyingSurface else { return }
        let requested = requestedStateAfterExit
        requestedStateAfterExit = nil
        destroyViewer()
        let nextState = requested ?? (processAlive ? .detached : .exited)
        setSessionState(nextState)
    }

    func ghosttyCommandFinished() {
        activityDetector?.recordOutput()
    }

    func ghosttyChildExited(exitCode: UInt32) {
        InputRoutingLog.log("terminal[\(session.tileID)] ghostty viewer exited code=\(exitCode)")
        ghosttyViewerClosed(processAlive: false)
    }

    func ghosttyTitleChanged(_ title: String) {
        guard let label = Self.runtimeLabel(fromTerminalTitle: title) else { return }
        InputRoutingLog.log("terminal[\(session.tileID)] runtime label=\(label ?? "<cleared>")")
        onRuntimeLabelChange?(label)
    }

    func setTerminalTitle(source: MachinenTerminalView, title: String) {
        ghosttyTitleChanged(title)
    }

    func ghosttyWorkingDirectoryChanged(_ path: String) {
        guard !path.isEmpty else { return }
    }

    func ghosttyCellSizeChanged(width: UInt32, height: UInt32) {
        cellSize = NSSize(width: Int(width), height: Int(height))
    }

    func ghosttyMouseShapeChanged(_ shape: ghostty_action_mouse_shape_e) {
        switch shape {
        case GHOSTTY_MOUSE_SHAPE_POINTER: NSCursor.pointingHand.set()
        case GHOSTTY_MOUSE_SHAPE_CROSSHAIR: NSCursor.crosshair.set()
        case GHOSTTY_MOUSE_SHAPE_NOT_ALLOWED: NSCursor.operationNotAllowed.set()
        case GHOSTTY_MOUSE_SHAPE_W_RESIZE, GHOSTTY_MOUSE_SHAPE_E_RESIZE,
             GHOSTTY_MOUSE_SHAPE_EW_RESIZE: NSCursor.resizeLeftRight.set()
        case GHOSTTY_MOUSE_SHAPE_N_RESIZE, GHOSTTY_MOUSE_SHAPE_S_RESIZE,
             GHOSTTY_MOUSE_SHAPE_NS_RESIZE: NSCursor.resizeUpDown.set()
        default: NSCursor.iBeam.set()
        }
    }

    func ghosttyMouseVisibilityChanged(_ visible: Bool) {
        if visible { NSCursor.unhide() } else { NSCursor.hide() }
    }

    private func destroyViewer() {
        if let active = surface {
            surface = nil
            destroyingSurface = true
            ghostty_surface_free(active)
            destroyingSurface = false
        }
        outputTap?.close()
        outputTap = nil
    }

    private func setSessionState(_ state: TerminalSession.State) {
        session.state = state
        onStateChange?(state)
    }

    static func intrinsicSurfacePixelSize(
        for logicalSize: NSSize,
        backingScale: CGFloat
    ) -> (width: UInt32, height: UInt32) {
        (
            UInt32(max(1, (logicalSize.width * backingScale).rounded())),
            UInt32(max(1, (logicalSize.height * backingScale).rounded()))
        )
    }

    private func updateGhosttyGeometry() {
        guard let surface else { return }
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        ghostty_surface_set_content_scale(surface, scale, scale)
        // Ancestor frame/bounds transforms are the spatial camera. Ghostty must
        // keep rendering the tile's intrinsic grid while AppKit scales that
        // unchanged surface in Navigate mode.
        let pixels = Self.intrinsicSurfacePixelSize(for: bounds.size, backingScale: scale)
        ghostty_surface_set_size(surface, pixels.width, pixels.height)
        if let screen = window?.screen {
            ghostty_surface_set_display_id(
                surface,
                screen.deviceDescription[.init("NSScreenNumber")] as? UInt32 ?? 0
            )
        }
    }

    private func loginShell() -> String {
        ProcessInfo.processInfo.environment["SHELL"].flatMap {
            FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil
        } ?? "/bin/zsh"
    }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted, let surface { ghostty_surface_set_focus(surface, terminalInputFocused) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let accepted = super.resignFirstResponder()
        if accepted, let surface { ghostty_surface_set_focus(surface, false) }
        return accepted
    }

    override func keyDown(with event: NSEvent) {
        guard terminalInputFocused else {
            super.keyDown(with: event)
            return
        }
        guard let surface else { return }
        let translated = NSEvent.ModifierFlags.ghosttyTranslationModifiers(
            ghostty_surface_key_translation_mods(surface, event.modifierFlags.ghosttyModifiers)
        )
        var translationModifiers = event.modifierFlags
        for flag in [NSEvent.ModifierFlags.shift, .control, .option, .command] {
            if translated.contains(flag) {
                translationModifiers.insert(flag)
            } else {
                translationModifiers.remove(flag)
            }
        }
        let translationEvent: NSEvent
        if translationModifiers == event.modifierFlags {
            translationEvent = event
        } else {
            translationEvent = NSEvent.keyEvent(
                with: event.type,
                location: event.locationInWindow,
                modifierFlags: translationModifiers,
                timestamp: event.timestamp,
                windowNumber: event.windowNumber,
                context: nil,
                characters: event.characters(byApplyingModifiers: translationModifiers) ?? "",
                charactersIgnoringModifiers: event.charactersIgnoringModifiers ?? "",
                isARepeat: event.isARepeat,
                keyCode: event.keyCode
            ) ?? event
        }

        let hadMarkedText = hasMarkedText()
        keyTextAccumulator = []
        interpretKeyEvents([translationEvent])
        let accumulated = keyTextAccumulator ?? []
        keyTextAccumulator = nil
        syncPreedit(clearIfNeeded: hadMarkedText)

        let action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS
        if accumulated.isEmpty {
            _ = sendKey(
                action,
                event: event,
                translationModifiers: translationModifiers,
                text: translationEvent.ghosttyText,
                composing: hasMarkedText() || hadMarkedText
            )
        } else {
            for text in accumulated {
                _ = sendKey(
                    action,
                    event: event,
                    translationModifiers: translationModifiers,
                    text: text
                )
            }
        }
    }

    override func keyUp(with event: NSEvent) {
        _ = sendKey(GHOSTTY_ACTION_RELEASE, event: event, text: nil)
    }

    override func flagsChanged(with event: NSEvent) {
        let pressed = event.modifierFlags.ghosttyModifiers.rawValue
        let mask: UInt32
        switch event.keyCode {
        case 0x39: mask = GHOSTTY_MODS_CAPS.rawValue
        case 0x38, 0x3C: mask = GHOSTTY_MODS_SHIFT.rawValue
        case 0x3B, 0x3E: mask = GHOSTTY_MODS_CTRL.rawValue
        case 0x3A, 0x3D: mask = GHOSTTY_MODS_ALT.rawValue
        case 0x37, 0x36: mask = GHOSTTY_MODS_SUPER.rawValue
        default: return
        }
        _ = sendKey(pressed & mask == 0 ? GHOSTTY_ACTION_RELEASE : GHOSTTY_ACTION_PRESS, event: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.type == .keyDown,
              terminalInputFocused,
              window?.firstResponder === self
        else { return false }
        if event.modifierFlags.contains(.command) { return false }
        keyDown(with: event)
        return true
    }

    private func sendKey(
        _ action: ghostty_input_action_e,
        event: NSEvent,
        translationModifiers: NSEvent.ModifierFlags? = nil,
        text: String? = nil,
        composing: Bool = false
    ) -> Bool {
        guard let surface else { return false }
        var key = event.ghosttyKeyEvent(action, translationModifiers: translationModifiers)
        key.composing = composing
        guard let text, !text.isEmpty, text.utf8.first.map({ $0 >= 0x20 }) == true else {
            return ghostty_surface_key(surface, key)
        }
        return text.withCString {
            key.text = $0
            return ghostty_surface_key(surface, key)
        }
    }

    override func mouseDown(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseDown \(InputRoutingLog.event(event))")
        window?.makeFirstResponder(self)
        sendMousePosition(event)
        sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS)
    }

    override func mouseUp(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseUp \(InputRoutingLog.event(event))")
        sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE)
    }

    override func mouseDragged(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseDragged \(InputRoutingLog.event(event))")
        sendMousePosition(event)
    }

    override func rightMouseDown(with event: NSEvent) {
        sendMousePosition(event)
        sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS)
    }

    override func rightMouseUp(with event: NSEvent) {
        sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE)
    }

    override func rightMouseDragged(with event: NSEvent) { sendMousePosition(event) }
    override func otherMouseDown(with event: NSEvent) { sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS) }
    override func otherMouseUp(with event: NSEvent) { sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE) }
    override func otherMouseDragged(with event: NSEvent) { sendMousePosition(event) }
    override func mouseMoved(with event: NSEvent) { sendMousePosition(event) }
    override func mouseEntered(with event: NSEvent) { sendMousePosition(event) }

    override func mouseExited(with event: NSEvent) {
        guard NSEvent.pressedMouseButtons == 0, let surface else { return }
        ghostty_surface_mouse_pos(surface, -1, -1, event.modifierFlags.ghosttyModifiers)
    }

    override func scrollWheel(with event: NSEvent) {
        guard let surface else { return }
        var x = event.scrollingDeltaX
        var y = event.scrollingDeltaY
        if event.hasPreciseScrollingDeltas {
            x *= 2
            y *= 2
        }
        ghostty_surface_mouse_scroll(surface, x, y, event.ghosttyScrollModifiers)
    }

    private func sendMousePosition(_ event: NSEvent) {
        guard let surface else { return }
        let position = convert(event.locationInWindow, from: nil)
        ghostty_surface_mouse_pos(
            surface,
            position.x,
            bounds.height - position.y,
            event.modifierFlags.ghosttyModifiers
        )
    }

    private func sendMouseButton(_ event: NSEvent, state: ghostty_input_mouse_state_e) {
        guard let surface else { return }
        _ = ghostty_surface_mouse_button(
            surface,
            state,
            event.ghosttyMouseButton,
            event.modifierFlags.ghosttyModifiers
        )
    }

    @objc func copy(_ sender: Any?) {
        InputRoutingLog.log("terminal[\(session.tileID)] copy")
        performGhosttyAction("copy_to_clipboard")
    }

    @objc func paste(_ sender: Any?) {
        InputRoutingLog.log("terminal[\(session.tileID)] paste")
        performGhosttyAction("paste_from_clipboard")
    }

    override func selectAll(_ sender: Any?) {
        performGhosttyAction("select_all")
    }

    private func performGhosttyAction(_ action: String) {
        guard let surface else { return }
        action.withCString { _ = ghostty_surface_binding_action(surface, $0, UInt(action.utf8.count)) }
    }

    func hasMarkedText() -> Bool { markedText.length > 0 }

    func markedRange() -> NSRange {
        markedText.length > 0 ? NSRange(location: 0, length: markedText.length) : NSRange()
    }

    func selectedRange() -> NSRange {
        guard let surface else { return NSRange() }
        var text = ghostty_text_s()
        guard ghostty_surface_read_selection(surface, &text) else { return NSRange() }
        defer { ghostty_surface_free_text(surface, &text) }
        return NSRange(location: Int(text.offset_start), length: Int(text.offset_len))
    }

    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        if let value = string as? NSAttributedString {
            markedText = NSMutableAttributedString(attributedString: value)
        } else if let value = string as? String {
            markedText = NSMutableAttributedString(string: value)
        }
        if keyTextAccumulator == nil { syncPreedit() }
    }

    func unmarkText() {
        guard markedText.length > 0 else { return }
        markedText.mutableString.setString("")
        syncPreedit()
    }

    func validAttributesForMarkedText() -> [NSAttributedString.Key] { [] }

    func attributedSubstring(
        forProposedRange range: NSRange,
        actualRange: NSRangePointer?
    ) -> NSAttributedString? {
        guard range.length > 0, let surface else { return nil }
        var text = ghostty_text_s()
        guard ghostty_surface_read_selection(surface, &text), let value = text.text else { return nil }
        defer { ghostty_surface_free_text(surface, &text) }
        return NSAttributedString(string: String(cString: value))
    }

    func characterIndex(for point: NSPoint) -> Int { 0 }

    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
        guard let surface else { return window?.convertToScreen(convert(bounds, to: nil)) ?? bounds }
        var x = 0.0
        var y = 0.0
        var width = Double(cellSize.width)
        var height = Double(cellSize.height)
        ghostty_surface_ime_point(surface, &x, &y, &width, &height)
        let local = NSRect(
            x: x,
            y: bounds.height - y,
            width: range.length == 0 ? 0 : width,
            height: max(height, cellSize.height)
        )
        let windowRect = convert(local, to: nil)
        return window?.convertToScreen(windowRect) ?? windowRect
    }

    func insertText(_ string: Any, replacementRange: NSRange) {
        let value: String
        if let attributed = string as? NSAttributedString {
            value = attributed.string
        } else if let string = string as? String {
            value = string
        } else {
            return
        }
        unmarkText()
        if keyTextAccumulator != nil {
            keyTextAccumulator?.append(value)
        } else if let surface {
            value.withCString { ghostty_surface_text(surface, $0, UInt(value.utf8.count)) }
        }
    }

    override func doCommand(by selector: Selector) {
        switch selector {
        case #selector(moveToBeginningOfDocument(_:)): performGhosttyAction("scroll_to_top")
        case #selector(moveToEndOfDocument(_:)): performGhosttyAction("scroll_to_bottom")
        default: break
        }
    }

    private func syncPreedit(clearIfNeeded: Bool = true) {
        guard let surface else { return }
        if markedText.length > 0 {
            let value = markedText.string
            value.withCString { ghostty_surface_preedit(surface, $0, UInt(value.utf8.count)) }
        } else if clearIfNeeded {
            ghostty_surface_preedit(surface, nil, 0)
        }
    }
}

private enum GhosttyViewError: LocalizedError {
    case surfaceCreationFailed

    var errorDescription: String? { "Ghostty could not create a terminal surface" }
}
