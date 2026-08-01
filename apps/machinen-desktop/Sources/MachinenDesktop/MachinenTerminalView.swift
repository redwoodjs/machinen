import AppKit
import CoreText
import GhosttyKit

struct TerminalGeometrySignal: Equatable {
    let geometry: TerminalGeometry
    let viewerClientID: UInt64
    let ownsResize: Bool
    let localColumns: UInt32
    let localRows: UInt32
}

/// An embedded Ghostty surface attached to a persistent Machinen session worker.
final class MachinenTerminalView: NSView, @preconcurrency NSTextInputClient {
    let session: TerminalSession

    var onStateChange: ((TerminalSession.State) -> Void)?
    var onActivityChange: ((TerminalSession.ActivityState) -> Void)?
    var onCommandChange: ((String) -> Void)?
    var onShellNameChange: ((String) -> Void)?
    var onProcessInfoChange: ((TerminalProcessInfo?) -> Void)?
    var onGeometryChange: ((TerminalGeometry) -> Void)?
    var onRuntimeLabelChange: ((String?) -> Void)?
    var onWorkingDirectoryChange: ((String?) -> Void)?
    var onOutput: ((Data) -> Void)?
    var onContextMenuRequested: ((MachinenTerminalView, String?) -> NSMenu?)?

    nonisolated var ghosttySurface: ghostty_surface_t? { surface }

    nonisolated(unsafe) private var surface: ghostty_surface_t?
    private var activityDetector: TerminalActivityDetector?
    private var requestedStateAfterExit: TerminalSession.State?
    private var viewerPreparationID: UUID?
    private var attachRetryScheduled = false
    private var destroyingSurface = false
    private var terminalInputFocused = false
    private var markedText = NSMutableAttributedString()
    private var keyTextAccumulator: [String]?
    private var cellSize = NSSize(width: 10, height: 20)
    private(set) var sessionGeometry: TerminalGeometry?
    private var geometryLocalColumns: UInt32?
    private var geometryLocalRows: UInt32?
    private var ownsResizeControl = true
    private var pinsAuthoritativeGeometry = false
    private var lastSignaledGeometry: TerminalGeometry?
    private var geometryDisplayScale = NSSize(width: 1, height: 1)
    private var geometrySourceSize: NSSize?
    var rendersAuthoritativeGrid: Bool {
        sessionGeometry != nil && (!ownsResizeControl || pinsAuthoritativeGeometry)
    }
    private var tracking: NSTrackingArea?
    private var selectionAnchorInWindow: NSPoint?
    private var outputTap: GhosttyOutputTap?
    private let terminalBackend: any TerminalSessionBackend

    override var acceptsFirstResponder: Bool { true }

    init(
        session: TerminalSession,
        terminalBackend: (any TerminalSessionBackend)? = nil,
        telemetryProvider: ((
            @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
        ) -> Void)? = nil
    ) {
        self.session = session
        let backend = terminalBackend ?? TerminalSessionBackendFactory.backend
        self.terminalBackend = backend
        super.init(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
        let provider: (
            @escaping @MainActor @Sendable (TerminalTelemetry?) -> Void
        ) -> Void
        if let telemetryProvider {
            provider = telemetryProvider
        } else {
            provider = { completion in backend.inspect(session, completion: completion) }
        }
        let detector = TerminalActivityDetector(session: session, telemetryProvider: provider)
        detector.onActivityChange = { [weak self] state in self?.onActivityChange?(state) }
        detector.onCommandChange = { [weak self] command in self?.onCommandChange?(command) }
        detector.onShellNameChange = { [weak self] shellName in self?.onShellNameChange?(shellName) }
        detector.onProcessInfoChange = { [weak self] info in self?.onProcessInfoChange?(info) }
        detector.onGeometryChange = { [weak self] geometry in
            self?.applySessionGeometry(geometry)
        }
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

    private static let geometryTitlePrefix = "machinen.geometry:v1:"

    static func geometrySignal(fromTerminalTitle title: String) -> TerminalGeometrySignal? {
        guard title.hasPrefix(geometryTitlePrefix) else { return nil }
        let fields = title.dropFirst(geometryTitlePrefix.count).split(separator: ":")
        guard fields.count == 8,
              let columns = UInt32(fields[0]), columns > 0,
              let rows = UInt32(fields[1]), rows > 0,
              let generation = UInt32(fields[2]), generation > 0,
              let rawOwner = UInt64(fields[3]),
              let viewerClientID = UInt64(fields[4]), viewerClientID > 0,
              let rawOwnsResize = UInt8(fields[5]), rawOwnsResize <= 1,
              let localColumns = UInt32(fields[6]), localColumns > 0,
              let localRows = UInt32(fields[7]), localRows > 0
        else { return nil }
        return TerminalGeometrySignal(
            geometry: TerminalGeometry(
                columns: columns,
                rows: rows,
                generation: generation,
                ownerClientId: rawOwner == 0 ? nil : rawOwner
            ),
            viewerClientID: viewerClientID,
            ownsResize: rawOwnsResize == 1,
            localColumns: localColumns,
            localRows: localRows
        )
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
        if ownsResizeControl && newSize != frame.size {
            pinsAuthoritativeGeometry = false
        }
        super.setFrameSize(newSize)
        updateGhosttyGeometry()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        if ownsResizeControl { pinsAuthoritativeGeometry = false }
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
        guard surface == nil, viewerPreparationID == nil, !destroyingSurface else {
            if session.state == .starting || session.state == .disconnected {
                scheduleAttachRetry()
            }
            return
        }
        guard GhosttyRuntime.shared.app != nil else {
            setSessionState(.disconnected)
            scheduleAttachRetry(after: 1)
            return
        }

        requestedStateAfterExit = nil
        outputTap?.close()
        outputTap = nil
        let preparationID = UUID()
        viewerPreparationID = preparationID
        setSessionState(.starting)
        InputRoutingLog.log("terminal[\(session.tileID)] prepares viewer asynchronously")
        terminalBackend.prepareViewer(for: session, loginShell: loginShell()) { [weak self] result in
            self?.completeViewerPreparation(result, id: preparationID)
        }
    }

    private func completeViewerPreparation(
        _ result: Result<TerminalViewerLaunch, Error>,
        id: UUID
    ) {
        guard viewerPreparationID == id else {
            if case .success = result, requestedStateAfterExit == .stopped {
                // A stop can win while SSH is still creating the worker. Remove
                // that late worker rather than leaking a session with no tile.
                terminalBackend.remove(session)
            }
            return
        }
        viewerPreparationID = nil
        guard window != nil,
              session.state == .starting || session.state == .disconnected
        else { return }

        switch result {
        case let .success(launch):
            do {
                try installGhosttySurface(for: launch)
                InputRoutingLog.log("terminal[\(session.tileID)] Ghostty surface is ready")
            } catch {
                handleViewerPreparationFailure(error)
            }
        case let .failure(error):
            handleViewerPreparationFailure(error)
        }
    }

    private func installGhosttySurface(for launch: TerminalViewerLaunch) throws {
        guard let app = GhosttyRuntime.shared.app else {
            throw GhosttyViewError.surfaceCreationFailed
        }
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
    }

    private func handleViewerPreparationFailure(_ error: Error) {
        outputTap?.close()
        outputTap = nil
        InputRoutingLog.log(
            "terminal[\(session.tileID)] ghostty viewer failed: \(error.localizedDescription)"
        )
        // The persistent worker may still be alive even when AppKit cannot
        // create its Ghostty surface. Preserve reconnect intent instead of
        // recording a stopped process that Machinen never terminated.
        setSessionState(.disconnected)
        scheduleAttachRetry(after: 1)
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

    private func scheduleAttachRetry(after delay: TimeInterval = 0.12) {
        guard !attachRetryScheduled else { return }
        attachRetryScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            self.attachRetryScheduled = false
            if self.session.state == .starting || self.session.state == .disconnected {
                self.attach()
            }
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
        onWorkingDirectoryChange?(nil)
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

    private func applyGeometrySignal(_ signal: TerminalGeometrySignal) {
        guard signal.viewerClientID == session.viewerClientID else { return }
        geometryLocalColumns = signal.localColumns
        geometryLocalRows = signal.localRows
        let ownsResize = signal.ownsResize
            || signal.geometry.ownerClientId == session.viewerClientID
        if ownsResize, let previous = lastSignaledGeometry {
            let dimensionsChanged = previous.columns != signal.geometry.columns
                || previous.rows != signal.geometry.rows
            let localMatchesPrevious = previous.columns == signal.localColumns
                && previous.rows == signal.localRows
            let localMatchesAuthoritative = signal.geometry.columns == signal.localColumns
                && signal.geometry.rows == signal.localRows
            if dimensionsChanged && localMatchesPrevious && !localMatchesAuthoritative {
                // A same-user control request changed the PTY independently of
                // this window. Keep that explicit grid until this viewer itself
                // reports a different local size.
                pinsAuthoritativeGeometry = true
            } else if !dimensionsChanged && !localMatchesAuthoritative {
                // The local window changed first. Let its resize lease update
                // the worker instead of mistaking the old broadcast for a pin.
                pinsAuthoritativeGeometry = false
            }
        } else if !ownsResize {
            pinsAuthoritativeGeometry = false
        }
        lastSignaledGeometry = signal.geometry
        applySessionGeometry(signal.geometry, ownsResize: ownsResize)
    }

    private func applySessionGeometry(
        _ geometry: TerminalGeometry,
        ownsResize: Bool? = nil
    ) {
        let changed = geometry != sessionGeometry
        sessionGeometry = geometry
        if let ownsResize {
            ownsResizeControl = ownsResize
        } else if let ownerClientID = geometry.ownerClientId {
            ownsResizeControl = ownerClientID == session.viewerClientID
        }
        updateGhosttyGeometry()
        if changed {
            InputRoutingLog.log(
                "terminal[\(session.tileID)] geometry=\(geometry.columns)x\(geometry.rows) "
                    + "generation=\(geometry.generation) owner="
                    + "\(geometry.ownerClientId.map(String.init) ?? "none")"
            )
            onGeometryChange?(geometry)
        }
    }

    func ghosttyTitleChanged(_ title: String) {
        if let signal = Self.geometrySignal(fromTerminalTitle: title) {
            applyGeometrySignal(signal)
            return
        }
        guard let label = Self.runtimeLabel(fromTerminalTitle: title) else { return }
        InputRoutingLog.log("terminal[\(session.tileID)] runtime label=\(label ?? "<cleared>")")
        onRuntimeLabelChange?(label)
    }

    func setTerminalTitle(source: MachinenTerminalView, title: String) {
        ghosttyTitleChanged(title)
    }

    static func normalizedOSC7WorkingDirectory(_ path: String) -> String? {
        guard path.hasPrefix("/"), path.utf8.count <= 16_384,
              path.unicodeScalars.allSatisfy({
                  !CharacterSet.controlCharacters.contains($0)
              })
        else { return nil }
        return path
    }

    func ghosttyWorkingDirectoryChanged(_ path: String) {
        guard let path = Self.normalizedOSC7WorkingDirectory(path),
              path != session.currentWorkingDirectory
        else { return }
        InputRoutingLog.log("terminal[\(session.tileID)] OSC 7 cwd=\(path)")
        onWorkingDirectoryChange?(path)
    }

    func ghosttyCellSizeChanged(width: UInt32, height: UInt32) {
        let next = NSSize(width: Int(width), height: Int(height))
        if ownsResizeControl && next != cellSize {
            pinsAuthoritativeGeometry = false
        }
        cellSize = next
        updateGhosttyGeometry()
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
        viewerPreparationID = nil
        if let active = surface {
            surface = nil
            destroyingSurface = true
            ghostty_surface_free(active)
            destroyingSurface = false
            // Ghostty installs a retained layer-hosting IOSurfaceLayer. Remove
            // that dead layer before a reconnect installs the next renderer.
            wantsLayer = false
            layer = nil
        }
        outputTap?.close()
        outputTap = nil
        needsDisplay = true
    }

    private func setSessionState(_ state: TerminalSession.State) {
        session.state = state
        needsDisplay = true
        onStateChange?(state)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard surface == nil else { return }
        NSColor(calibratedWhite: 0.065, alpha: 1).setFill()
        dirtyRect.fill()
        let message: String
        switch session.state {
        case .starting:
            message = session.location.sshHost.map { "Connecting to \($0)…" }
                ?? "Starting terminal…"
        case .disconnected:
            message = session.location.sshHost.map { "Reconnecting to \($0)…" }
                ?? "Reconnecting…"
        case .stopped:
            message = "Terminal stopped"
        case .exited:
            message = "Terminal exited"
        case .detached:
            message = "Viewer detached"
        case .running:
            message = "Opening terminal…"
        }
        NSAttributedString(
            string: message,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                .foregroundColor: NSColor(calibratedWhite: 0.62, alpha: 1),
            ]
        ).draw(at: NSPoint(x: 16, y: max(16, bounds.midY - 8)))
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

    static func authoritativeSurfacePixelSize(
        viewportSize: NSSize,
        backingScale: CGFloat,
        cellSize: NSSize,
        geometry: TerminalGeometry,
        localColumns: UInt32?,
        localRows: UInt32?
    ) -> (width: UInt32, height: UInt32) {
        let viewport = intrinsicSurfacePixelSize(
            for: viewportSize,
            backingScale: backingScale
        )
        let columns = max(1, localColumns ?? UInt32(max(
            1,
            Int(CGFloat(viewport.width) / max(1, cellSize.width))
        )))
        let rows = max(1, localRows ?? UInt32(max(
            1,
            Int(CGFloat(viewport.height) / max(1, cellSize.height))
        )))
        let horizontalRemainder = max(
            0,
            CGFloat(viewport.width) - CGFloat(columns) * cellSize.width
        )
        let verticalRemainder = max(
            0,
            CGFloat(viewport.height) - CGFloat(rows) * cellSize.height
        )
        let width = CGFloat(geometry.columns) * max(1, cellSize.width)
            + horizontalRemainder
        let height = CGFloat(geometry.rows) * max(1, cellSize.height)
            + verticalRemainder
        return (
            UInt32(max(1, min(width.rounded(), CGFloat(UInt32.max)))),
            UInt32(max(1, min(height.rounded(), CGFloat(UInt32.max))))
        )
    }

    private func updateGhosttyGeometry() {
        guard let surface else { return }
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        ghostty_surface_set_content_scale(surface, scale, scale)
        // The controller renders at its local viewport size. Watchers render the
        // worker's authoritative cell grid into a separate drawable and fit that
        // drawable into their local viewport without asking the PTY to reflow.
        let viewportPixels = Self.intrinsicSurfacePixelSize(
            for: bounds.size,
            backingScale: scale
        )
        let usesAuthoritativeGrid = rendersAuthoritativeGrid
        let pixels = if usesAuthoritativeGrid, let geometry = sessionGeometry {
            Self.authoritativeSurfacePixelSize(
                viewportSize: bounds.size,
                backingScale: scale,
                cellSize: cellSize,
                geometry: geometry,
                localColumns: geometryLocalColumns,
                localRows: geometryLocalRows
            )
        } else {
            viewportPixels
        }
        ghostty_surface_set_size(surface, pixels.width, pixels.height)
        updateGeometryTransform(
            sourcePixels: pixels,
            viewportPixels: viewportPixels,
            enabled: usesAuthoritativeGrid
        )
        if let screen = window?.screen {
            ghostty_surface_set_display_id(
                surface,
                screen.deviceDescription[.init("NSScreenNumber")] as? UInt32 ?? 0
            )
        }
    }

    private func updateGeometryTransform(
        sourcePixels: (width: UInt32, height: UInt32),
        viewportPixels: (width: UInt32, height: UInt32),
        enabled: Bool
    ) {
        guard enabled, sourcePixels.width > 0, sourcePixels.height > 0,
              viewportPixels.width > 0, viewportPixels.height > 0
        else {
            geometryDisplayScale = NSSize(width: 1, height: 1)
            geometrySourceSize = nil
            layer?.setAffineTransform(.identity)
            return
        }
        let sourceAspect = CGFloat(sourcePixels.width) / CGFloat(sourcePixels.height)
        let viewportAspect = CGFloat(viewportPixels.width) / CGFloat(viewportPixels.height)
        let scaleX: CGFloat
        let scaleY: CGFloat
        if sourceAspect > viewportAspect {
            scaleX = 1
            scaleY = viewportAspect / sourceAspect
        } else {
            scaleX = sourceAspect / viewportAspect
            scaleY = 1
        }
        geometryDisplayScale = NSSize(width: scaleX, height: scaleY)
        let backingScale = window?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor
            ?? 2
        geometrySourceSize = NSSize(
            width: CGFloat(sourcePixels.width) / backingScale,
            height: CGFloat(sourcePixels.height) / backingScale
        )
        let anchor = layer?.anchorPoint ?? CGPoint(x: 0.5, y: 0.5)
        let translationX = (0.5 - anchor.x) * bounds.width * (1 - scaleX)
        let translationY = (0.5 - anchor.y) * bounds.height * (1 - scaleY)
        layer?.setAffineTransform(CGAffineTransform(
            a: scaleX,
            b: 0,
            c: 0,
            d: scaleY,
            tx: translationX,
            ty: translationY
        ))
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
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        if modifiers == [.command],
           let character = event.charactersIgnoringModifiers?.lowercased(),
           character == "k" || character == "o"
        {
            var ancestor = superview
            while let view = ancestor {
                if let deck = view as? TerminalDeckView {
                    if character == "k" {
                        InputRoutingLog.log("terminal routes command-k directly to command palette")
                        deck.toggleCommandPalette()
                    } else {
                        InputRoutingLog.log("terminal routes command-o directly to terminal menu")
                        deck.showTerminalContextMenu()
                    }
                    return true
                }
                ancestor = view.superview
            }
        }
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
        if sendMousePosition(event) {
            sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS)
        }
    }

    override func mouseUp(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseUp \(InputRoutingLog.event(event))")
        selectionAnchorInWindow = event.locationInWindow
        sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE)
    }

    override func mouseDragged(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] mouseDragged \(InputRoutingLog.event(event))")
        sendMousePosition(event)
    }

    override func rightMouseDown(with event: NSEvent) {
        InputRoutingLog.log("terminal[\(session.tileID)] rightMouseDown \(InputRoutingLog.event(event))")
        window?.makeFirstResponder(self)
        selectionAnchorInWindow = event.locationInWindow
        if let menu = onContextMenuRequested?(self, selectedText()) {
            NSMenu.popUpContextMenu(menu, with: event, for: self)
            return
        }
        if sendMousePosition(event) {
            sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS)
        }
    }

    override func rightMouseUp(with event: NSEvent) {
        guard onContextMenuRequested == nil else { return }
        sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE)
    }

    override func rightMouseDragged(with event: NSEvent) {
        guard onContextMenuRequested == nil else { return }
        sendMousePosition(event)
    }
    override func otherMouseDown(with event: NSEvent) {
        if sendMousePosition(event) {
            sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS)
        }
    }
    override func otherMouseUp(with event: NSEvent) { sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE) }
    override func otherMouseDragged(with event: NSEvent) { sendMousePosition(event) }
    override func mouseMoved(with event: NSEvent) { sendMousePosition(event) }
    override func mouseEntered(with event: NSEvent) { sendMousePosition(event) }

    override func mouseExited(with event: NSEvent) {
        guard NSEvent.pressedMouseButtons == 0, let surface else { return }
        ghostty_surface_mouse_pos(surface, -1, -1, event.modifierFlags.ghosttyModifiers)
    }

    override func scrollWheel(with event: NSEvent) {
        guard let surface,
              geometryMousePosition(convert(event.locationInWindow, from: nil)) != nil
        else { return }
        var x = event.scrollingDeltaX
        var y = event.scrollingDeltaY
        if event.hasPreciseScrollingDeltas {
            x *= 2
            y *= 2
        }
        ghostty_surface_mouse_scroll(surface, x, y, event.ghosttyScrollModifiers)
    }

    @discardableResult
    private func sendMousePosition(_ event: NSEvent) -> Bool {
        guard let surface else { return false }
        let position = convert(event.locationInWindow, from: nil)
        guard let mapped = geometryMousePosition(position) else {
            ghostty_surface_mouse_pos(
                surface,
                -1,
                -1,
                event.modifierFlags.ghosttyModifiers
            )
            return false
        }
        ghostty_surface_mouse_pos(
            surface,
            mapped.x,
            mapped.y,
            event.modifierFlags.ghosttyModifiers
        )
        return true
    }

    private func geometryMousePosition(_ position: NSPoint) -> NSPoint? {
        guard let sourceSize = geometrySourceSize else {
            return NSPoint(x: position.x, y: bounds.height - position.y)
        }
        let displayed = NSSize(
            width: bounds.width * geometryDisplayScale.width,
            height: bounds.height * geometryDisplayScale.height
        )
        let origin = NSPoint(
            x: bounds.midX - displayed.width / 2,
            y: bounds.midY - displayed.height / 2
        )
        guard displayed.width > 0, displayed.height > 0,
              position.x >= origin.x, position.x <= origin.x + displayed.width,
              position.y >= origin.y, position.y <= origin.y + displayed.height
        else { return nil }
        let x = (position.x - origin.x) / displayed.width * sourceSize.width
        let y = (position.y - origin.y) / displayed.height * sourceSize.height
        return NSPoint(x: x, y: sourceSize.height - y)
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

    func selectedText() -> String? {
        guard let surface else { return nil }
        var text = ghostty_text_s()
        guard ghostty_surface_read_selection(surface, &text), let value = text.text else { return nil }
        defer { ghostty_surface_free_text(surface, &text) }
        let selection = String(cString: value)
        return selection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : selection
    }

    func contextMenuAnchor(in view: NSView) -> NSPoint {
        if let selectionAnchorInWindow {
            return view.convert(selectionAnchorInWindow, from: nil)
        }
        return view.convert(NSPoint(x: bounds.midX, y: bounds.midY), from: self)
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
