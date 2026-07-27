import AppKit

final class TerminalDeckView: NSView {
    private struct CameraAnimation {
        let start: NSRect
        let target: NSRect
        let startedAt: TimeInterval
        let duration: TimeInterval
        let completion: (@MainActor () -> Void)?
    }

    private enum SpatialDragItem {
        case workspace(String)
        case terminal(String)
    }

    private struct SpatialDrag {
        let item: SpatialDragItem
        let startWindowPoint: NSPoint
        var didMove = false
    }

    private struct RecentlyClosedTerminal {
        let tile: TerminalTileView
        let position: Int
        let deadline: Date
    }

    private enum PaletteKind {
        case commands
        case newTerminal
        case runCommand
        case newItem
        case newWorkspace
        case newWorkspaceLocation
        case renameWorkspace
        case workspaceLocation
        case remoteWorkspaceLocation
    }

    private enum Motion {
        // Match cmdcmd's quick, symmetric window motion.
        static let cameraDuration: TimeInterval = 0.20
        static let terminalSwitchDuration: TimeInterval = 0.12
        static let peekDuration: TimeInterval = 0.12
        static let paneCloseDuration: TimeInterval = 0.18
        static let paneCloseScale: CGFloat = 0.92
        static let firstControlX: CGFloat = 0.42
        static let secondControlX: CGFloat = 0.58
    }

    private enum Metrics {
        static let topInset: CGFloat = 58
        static let bottomInset: CGFloat = 54
        static let sideInset: CGFloat = 28
        static let windowControlsInset: CGFloat = 92
        static let worldMargin: CGFloat = 90
        static let workspaceGap: CGFloat = 120
    }

    private let sceneView = CameraSceneView()
    private let statusBarView = MachinenStatusBarView()
    private let statusPopoverView = MachinenStatusPopoverView()
    private let sessionStore: TerminalSessionStore
    private var workspaces: [WorkspaceRecord]
    private var allSessionTiles: [TerminalTileView]
    private var workspaceClusters: [WorkspaceClusterView] = []
    private var workspaceUnion = NSRect.zero
    private var currentWorkspace: String?
    private var selectedIndex = 0
    private var focusedIndex: Int?
    private var isTransitioning = false
    private var isPeeking = false
    private var peekCameraBounds: NSRect?
    private var labelBuffer = ""
    private var isShuttingDown = false
    private var commandPalette: CommandPaletteView?
    private var paletteKind: PaletteKind?
    private var locationValidationProcess: Process?
    private var presentedOverlay: NSView?
    private var lastViewportSize = NSSize.zero
    private var cameraAnimation: CameraAnimation?
    private var cameraAnimationTimer: Timer?
    private var statusWidgets: [String: MachinenStatusWidget] = [:]
    private var spatialDrag: SpatialDrag?
    private var dragGhost: NSImageView?
    private weak var dragTargetTile: TerminalTileView?
    private weak var dragTargetWorkspace: WorkspaceClusterView?
    private var recentlyClosedTerminals: [String: RecentlyClosedTerminal]
    private var pendingCloseTasks: [String: DispatchWorkItem] = [:]
    private var undoCloseView: UndoTerminalCloseView?
    private let closeGracePeriod: TimeInterval = 5 * 60
    private let recentlyClosedLimit = 5

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    var onAPIEvent: ((String, [String: Any]) -> Void)?
    var shouldPublishTerminalOutput: ((JSONObject) -> Bool)?

    init(state: MachinenStoredState, sessionStore: TerminalSessionStore) {
        self.sessionStore = sessionStore
        workspaces = state.workspaces
        let initialTiles = state.sessions.map { TerminalTileView(session: $0) }
        allSessionTiles = initialTiles.filter { $0.session.pendingCloseDeadline == nil }
        recentlyClosedTerminals = Dictionary(uniqueKeysWithValues: initialTiles.compactMap { tile in
            guard let deadline = tile.session.pendingCloseDeadline else { return nil }
            return (
                tile.session.id,
                RecentlyClosedTerminal(
                    tile: tile,
                    position: tile.session.pendingClosePosition ?? state.sessions.count,
                    deadline: deadline
                )
            )
        })
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor
        layer?.masksToBounds = true

        addSubview(sceneView)
        let persistedTiles = allSessionTiles + recentlyClosedTerminals.values.map(\.tile)
        for tile in persistedTiles {
            installTile(tile)
            installPersistentTerminal(in: tile)
        }
        rebuildWorkspaceClusters()
        addSubview(statusBarView, positioned: .above, relativeTo: sceneView)
        addSubview(statusPopoverView, positioned: .above, relativeTo: statusBarView)
        statusBarView.onHoverChange = { [weak self] widget, anchor, detail in
            self?.updateStatusPopover(widget: widget, anchor: anchor, detail: detail)
        }
        statusBarView.onWidgetClick = { [weak self] widget in
            self?.copyPIDIfNeeded(from: widget) ?? false
        }
        statusBarView.onMouseDown = { [weak self] in
            self?.restoreInputFocus()
        }
        enterSoleTerminalIfNeeded()
        updateSelection()
        for terminalID in recentlyClosedTerminals.keys {
            schedulePendingCloseFinalization(terminalID: terminalID)
        }
        refreshUndoCloseView()
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private var activeSessionTiles: [TerminalTileView] {
        guard let currentWorkspace else { return [] }
        return activeSessionTiles(for: currentWorkspace)
    }

    private func activeSessionTiles(for workspaceID: String) -> [TerminalTileView] {
        allSessionTiles.filter { $0.session.workspaceID == workspaceID }
    }

    private var activeCount: Int {
        currentWorkspace == nil ? workspaceClusters.count : activeSessionTiles.count
    }

    private var activeColumns: Int {
        if currentWorkspace == nil {
            return min(2, max(1, workspaceClusters.count))
        }
        return workspaceCluster(named: currentWorkspace)?.sessionColumns ?? 1
    }

    private func workspaceCluster(named workspaceID: String?) -> WorkspaceClusterView? {
        guard let workspaceID else { return nil }
        return workspaceClusters.first { $0.workspaceID == workspaceID }
    }

    private func selectedWorkspaceID() -> String? {
        if let currentWorkspace { return currentWorkspace }
        guard workspaceClusters.indices.contains(selectedIndex) else { return nil }
        return workspaceClusters[selectedIndex].workspaceID
    }

    private func selectedWorkspaceRecord() -> WorkspaceRecord? {
        guard let workspaceID = selectedWorkspaceID() else { return nil }
        return workspaces.first { $0.id == workspaceID }
    }

    private func selectedWorkspace() -> String? {
        selectedWorkspaceRecord()?.name
    }

    private func selectedSessionTile() -> TerminalTileView? {
        let sessions = activeSessionTiles
        let index = focusedIndex ?? selectedIndex
        if sessions.indices.contains(index) {
            return sessions[index]
        }
        if let workspace = selectedWorkspace() {
            return allSessionTiles.first { $0.session.workspace == workspace }
        }
        return nil
    }

    private func selectedSession() -> TerminalSession? {
        selectedSessionTile()?.session
    }

    private func enterSoleTerminalIfNeeded() {
        guard allSessionTiles.count == 1, let tile = allSessionTiles.first else { return }
        currentWorkspace = tile.session.workspaceID
        selectedIndex = 0
        focusedIndex = 0
    }

    private func installTile(_ tile: TerminalTileView) {
        tile.onSelect = { [weak self, weak tile] event in
            guard let self, let tile else { return }
            self.window?.makeFirstResponder(self)
            self.focusClickedTile(at: event.locationInWindow, fallback: tile)
        }
        tile.onActivate = { [weak self, weak tile] event in
            guard let self, let tile else { return }
            self.focusClickedTile(at: event.locationInWindow, fallback: tile)
        }
        tile.terminalInputTarget = { [weak self, weak tile] event in
            // Unfocused previews reorder only inside their workspace. Only
            // the focused terminal's viewport owns terminal input.
            guard let self, self.currentWorkspace != nil, self.focusedIndex != nil, let fallback = tile,
                  let target = self.terminalTile(at: event.locationInWindow),
                  let terminal = target.terminalResponder
            else {
                InputRoutingLog.log("deck cannot resolve terminal input target")
                return nil
            }
            let localPoint = target.convert(event.locationInWindow, from: nil)
            guard target.terminalViewportRect.contains(localPoint) else {
                InputRoutingLog.log("deck pointer is outside terminal viewport target=\(target.session.tileID)")
                return nil
            }
            InputRoutingLog.log("deck routes terminal interaction receiver=\(fallback.session.tileID) target=\(target.session.tileID)")
            // Do not move the camera underneath an in-progress selection drag.
            self.focusClickedTile(at: event.locationInWindow, fallback: target, animate: false)
            return terminal
        }
        tile.onTerminalInteractionEnded = { [weak self, weak tile] in
            InputRoutingLog.log("deck ends terminal interaction receiver=\(tile?.session.tileID ?? "none")")
            self?.moveCamera()
        }
        tile.onDragBegan = { [weak self, weak tile] event in
            guard let self, let tile else { return }
            let source = self.terminalTile(at: event.locationInWindow) ?? tile
            self.beginSpatialDrag(for: source, event: event)
        }
        tile.onDragChanged = { [weak self] event in
            self?.updateSpatialDrag(with: event)
        }
        tile.onDragEnded = { [weak self] event in
            self?.endSpatialDrag(with: event) ?? false
        }
    }

    private func installPersistentTerminal(in tile: TerminalTileView) {
        let terminalView = MachinenTerminalView(session: tile.session)
        terminalView.onStateChange = { [weak self, weak tile] state in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.transition(to: state, terminalText: tile.session.terminalText)
            self.saveSessions()
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.stateChanged", data: self.terminalJSON(tile))
        }
        terminalView.onActivityChange = { [weak self, weak tile] state in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateActivity(to: state)
            self.workspaceCluster(named: tile.session.workspaceID)?.needsDisplay = true
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.activityChanged", data: self.terminalJSON(tile))
        }
        terminalView.onCommandChange = { [weak self, weak tile] command in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateObservedCommand(command)
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.commandChanged", data: self.terminalJSON(tile))
        }
        terminalView.onShellNameChange = { [weak self, weak tile] shellName in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateInferredShellName(shellName)
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.shellNameChanged", data: self.terminalJSON(tile))
        }
        terminalView.onProcessInfoChange = { [weak self, weak tile] info in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateProcessInfo(info)
            self.refreshStatusBar()
            self.emitAPIEvent("terminal.processChanged", data: self.terminalJSON(tile))
        }
        terminalView.onRuntimeLabelChange = { [weak self, weak tile] label in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.updateRuntimeLabel(label)
            self.refreshStatusBar()
            self.saveSessions()
            self.emitAPIEvent("terminal.labelChanged", data: self.terminalJSON(tile))
        }
        terminalView.onOutput = { [weak self, weak tile] data in
            guard let self, let tile else { return }
            var eventData: JSONObject = [
                "terminalId": tile.session.id,
                "tileId": tile.session.tileID,
                "workspaceId": tile.session.workspaceID,
            ]
            guard self.shouldPublishTerminalOutput?(eventData) ?? false else { return }
            eventData["dataBase64"] = data.base64EncodedString()
            self.emitAPIEvent("terminal.output", data: eventData)
        }
        tile.installTerminalView(terminalView)
    }

    private var persistedSessionTiles: [TerminalTileView] {
        allSessionTiles + recentlyClosedTerminals.values
            .sorted { $0.position < $1.position }
            .map(\.tile)
    }

    private func saveSessions() {
        sessionStore.save(MachinenStoredState(
            workspaces: workspaces,
            sessions: persistedSessionTiles.map(\.session)
        ))
    }

    private func rebuildWorkspaceClusters() {
        let existing = Dictionary(uniqueKeysWithValues: workspaceClusters.map { ($0.workspaceID, $0) })
        var usedLabels = Set(existing.values.map(\.label))
        workspaceClusters = workspaces.map { workspace in
            let cluster: WorkspaceClusterView
            if let current = existing[workspace.id] {
                current.workspace = workspace.name
                cluster = current
            } else {
                let base = String(workspace.name.lowercased().prefix(2)).padding(
                    toLength: 2,
                    withPad: "w",
                    startingAt: 0
                )
                var label = base
                var suffix = 2
                while usedLabels.contains(label) {
                    label = String(base.prefix(1)) + String(suffix)
                    suffix += 1
                }
                usedLabels.insert(label)
                cluster = WorkspaceClusterView(
                    workspaceID: workspace.id,
                    workspace: workspace.name,
                    label: label
                )
                cluster.onSelect = { [weak self, weak cluster] in
                    guard let self, let cluster,
                          let index = self.workspaceClusters.firstIndex(where: { $0 === cluster })
                    else { return }
                    self.window?.makeFirstResponder(self)
                    if self.currentWorkspace == nil {
                        self.activate(index)
                    }
                }
                cluster.onActivate = { [weak self, weak cluster] in
                    guard let self, let cluster,
                          let index = self.workspaceClusters.firstIndex(where: { $0 === cluster }),
                          self.currentWorkspace == nil
                    else { return }
                    self.activate(index)
                }
                cluster.onDragBegan = { [weak self, weak cluster] event in
                    guard let self, let cluster else { return }
                    self.beginSpatialDrag(for: cluster, event: event)
                }
                cluster.onDragChanged = { [weak self] event in
                    self?.updateSpatialDrag(with: event)
                }
                cluster.onDragEnded = { [weak self] event in
                    self?.endSpatialDrag(with: event) ?? false
                }
                sceneView.addSubview(cluster)
            }
            return cluster
        }

        let retainedIDs = Set(workspaces.map(\.id))
        for (id, cluster) in existing where !retainedIDs.contains(id) {
            cluster.removeFromSuperview()
        }
    }

    override func layout() {
        super.layout()
        commandPalette?.frame = bounds
        statusBarView.frame = NSRect(
            x: 0,
            y: 0,
            width: bounds.width,
            height: MachinenStatusBarView.preferredHeight
        )
        if let undoCloseView {
            let width = min(620, max(420, bounds.width - 32))
            undoCloseView.frame = NSRect(
                x: bounds.maxX - width - 16,
                y: statusBarView.frame.maxY + 12,
                width: width,
                height: 62
            ).integral
        }
        guard bounds.width > 0, bounds.height > 0 else { return }
        if lastViewportSize != bounds.size {
            lastViewportSize = bounds.size
            updateWorldGeometry()
            setCameraImmediately()
        }
    }

    private func updateWorldGeometry() {
        let terminalSize = NSSize(width: max(1, bounds.width), height: max(1, bounds.height))
        let sizes = workspaceClusters.map { cluster in
            cluster.arrange(
                sessions: allSessionTiles.filter { $0.session.workspaceID == cluster.workspaceID },
                terminalSize: terminalSize
            )
        }
        guard !workspaceClusters.isEmpty else {
            workspaceUnion = .zero
            return
        }

        let columns = min(2, workspaceClusters.count)
        let rows = Int(ceil(Double(workspaceClusters.count) / Double(columns)))
        var columnWidths = Array(repeating: CGFloat.zero, count: columns)
        var rowHeights = Array(repeating: CGFloat.zero, count: rows)
        for (index, size) in sizes.enumerated() {
            columnWidths[index % columns] = max(columnWidths[index % columns], size.width)
            rowHeights[index / columns] = max(rowHeights[index / columns], size.height)
        }

        var xOffsets = Array(repeating: Metrics.worldMargin, count: columns)
        for column in 1..<columns {
            xOffsets[column] = xOffsets[column - 1] + columnWidths[column - 1] + Metrics.workspaceGap
        }
        var yOffsets = Array(repeating: Metrics.worldMargin, count: rows)
        for row in 1..<rows {
            yOffsets[row] = yOffsets[row - 1] + rowHeights[row - 1] + Metrics.workspaceGap
        }

        workspaceUnion = .null
        for (index, cluster) in workspaceClusters.enumerated() {
            let column = index % columns
            let row = index / columns
            let size = sizes[index]
            cluster.frame = NSRect(
                x: xOffsets[column] + (columnWidths[column] - size.width) / 2,
                y: yOffsets[row] + (rowHeights[row] - size.height) / 2,
                width: size.width,
                height: size.height
            ).integral
            workspaceUnion = workspaceUnion.union(cluster.frame)
        }
    }

    private func cameraBounds(for target: NSRect, viewport: NSRect) -> NSRect {
        guard !target.isNull, target.width > 0, target.height > 0,
              viewport.width > 0, viewport.height > 0,
              bounds.width > 0, bounds.height > 0
        else { return NSRect(origin: .zero, size: bounds.size) }
        let scale = min(viewport.width / target.width, viewport.height / target.height)
        return NSRect(
            x: target.midX - viewport.midX / scale,
            y: target.midY - viewport.midY / scale,
            width: bounds.width / scale,
            height: bounds.height / scale
        )
    }

    private func overviewViewport() -> NSRect {
        NSRect(
            x: Metrics.sideInset,
            y: Metrics.topInset,
            width: max(1, bounds.width - Metrics.sideInset * 2),
            height: max(1, bounds.height - Metrics.topInset - Metrics.bottomInset)
        )
    }

    private func currentCameraBounds() -> NSRect {
        if let focusedIndex {
            let sessions = activeSessionTiles
            if sessions.indices.contains(focusedIndex),
               let cluster = workspaceCluster(named: currentWorkspace),
               let terminalFrame = cluster.frameForSession(sessions[focusedIndex], in: sceneView)
            {
                return cameraBounds(for: terminalFrame, viewport: bounds)
            }
        }
        if let cluster = workspaceCluster(named: currentWorkspace) {
            return cameraBounds(for: cluster.frame, viewport: bounds)
        }
        return cameraBounds(
            for: workspaceUnion.insetBy(dx: -Metrics.worldMargin / 2, dy: -Metrics.worldMargin / 2),
            viewport: overviewViewport()
        )
    }

    private func setCameraImmediately() {
        cameraAnimationTimer?.invalidate()
        cameraAnimationTimer = nil
        cameraAnimation = nil
        isTransitioning = false

        // The scene stays viewport-sized. Changing its world-space bounds moves
        // a camera over stable terminal surfaces instead of resizing the scene.
        sceneView.frame = bounds
        sceneView.bounds = currentCameraBounds()
        needsDisplay = true
    }

    private func moveCamera(
        to destination: NSRect? = nil,
        duration: TimeInterval = Motion.cameraDuration,
        completion: (@MainActor () -> Void)? = nil
    ) {
        statusPopoverView.dismiss()
        cameraAnimationTimer?.invalidate()
        let target = destination ?? currentCameraBounds()
        let start = sceneView.bounds
        guard duration > 0, start.width > 0, start.height > 0,
              target.width > 0, target.height > 0
        else {
            sceneView.bounds = target
            isTransitioning = false
            restoreInputFocus()
            completion?()
            return
        }

        isTransitioning = true
        needsDisplay = true
        sceneView.frame = bounds
        cameraAnimation = CameraAnimation(
            start: start,
            target: target,
            startedAt: ProcessInfo.processInfo.systemUptime,
            duration: duration,
            completion: completion
        )
        let timer = Timer(
            timeInterval: 1 / 120,
            target: self,
            selector: #selector(stepCameraAnimation(_:)),
            userInfo: nil,
            repeats: true
        )
        cameraAnimationTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    @objc private func stepCameraAnimation(_ timer: Timer) {
        guard let animation = cameraAnimation else {
            timer.invalidate()
            return
        }
        let elapsed = ProcessInfo.processInfo.systemUptime - animation.startedAt
        let linearProgress = min(1, max(0, elapsed / animation.duration))
        let progress = cameraAnimationProgress(CGFloat(linearProgress))

        let widthRatio = animation.target.width / animation.start.width
        let heightRatio = animation.target.height / animation.start.height
        let width = animation.start.width * pow(widthRatio, progress)
        let height = animation.start.height * pow(heightRatio, progress)
        let centerX = animation.start.midX + (animation.target.midX - animation.start.midX) * progress
        let centerY = animation.start.midY + (animation.target.midY - animation.start.midY) * progress
        sceneView.bounds = NSRect(
            x: centerX - width / 2,
            y: centerY - height / 2,
            width: width,
            height: height
        )

        guard linearProgress >= 1 else { return }
        timer.invalidate()
        cameraAnimationTimer = nil
        cameraAnimation = nil
        sceneView.bounds = animation.target
        isTransitioning = false
        restoreInputFocus()
        needsDisplay = true
        animation.completion?()
    }

    private func cameraAnimationProgress(_ linearProgress: CGFloat) -> CGFloat {
        var lower: CGFloat = 0
        var upper: CGFloat = 1
        for _ in 0..<10 {
            let parameter = (lower + upper) / 2
            let x = cubicBezierCoordinate(
                parameter,
                firstControl: Motion.firstControlX,
                secondControl: Motion.secondControlX
            )
            if x < linearProgress {
                lower = parameter
            } else {
                upper = parameter
            }
        }
        let parameter = (lower + upper) / 2
        return cubicBezierCoordinate(parameter, firstControl: 0, secondControl: 1)
    }

    private func cubicBezierCoordinate(
        _ parameter: CGFloat,
        firstControl: CGFloat,
        secondControl: CGFloat
    ) -> CGFloat {
        let inverse = 1 - parameter
        return 3 * inverse * inverse * parameter * firstControl
            + 3 * inverse * parameter * parameter * secondControl
            + parameter * parameter * parameter
    }

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        if focusedIndex != nil { return }
        guard !isTransitioning else { return }

        if modifiers == [.command] {
            switch event.keyCode {
            case 123:
                reorderSelection(horizontal: -1, vertical: 0)
                return
            case 124:
                reorderSelection(horizontal: 1, vertical: 0)
                return
            case 125:
                reorderSelection(horizontal: 0, vertical: 1)
                return
            case 126:
                reorderSelection(horizontal: 0, vertical: -1)
                return
            default:
                break
            }
        }

        if modifiers.isEmpty {
            switch event.keyCode {
            case 123:
                moveSelection(horizontal: -1, vertical: 0)
                return
            case 124:
                moveSelection(horizontal: 1, vertical: 0)
                return
            case 125:
                moveSelection(horizontal: 0, vertical: 1)
                return
            case 126:
                moveSelection(horizontal: 0, vertical: -1)
                return
            case 36, 76:
                activate(selectedIndex)
                return
            case 49:
                if !event.isARepeat { beginPeek() }
                return
            case 53:
                if currentWorkspace != nil { showWorkspaceDeck() }
                return
            case 51:
                removeLastLabelCharacter()
                return
            default:
                break
            }

            if let characters = event.charactersIgnoringModifiers?.lowercased(),
               characters.count == 1,
               let scalar = characters.unicodeScalars.first,
               CharacterSet.alphanumerics.contains(scalar)
            {
                appendLabelCharacter(characters)
                return
            }
        }
        super.keyDown(with: event)
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49, isPeeking {
            endPeek()
            return
        }
        super.keyUp(with: event)
    }

    private func copyPIDIfNeeded(from widget: MachinenStatusWidget) -> Bool {
        guard widget.id == "machinen.pid" else { return false }
        let pid = widget.value.replacingOccurrences(of: "PID ", with: "")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pid, forType: .string)
        InputRoutingLog.log("copied terminal PID \(pid) from status bar")
        return true
    }

    private func updateStatusPopover(
        widget: MachinenStatusWidget?,
        anchor: NSRect,
        detail: String?
    ) {
        guard let detail, !detail.isEmpty else {
            statusPopoverView.dismiss()
            return
        }
        let title: String
        let tone: MachinenStatusWidget.Tone
        if let widget {
            title = widget.label ?? widget.id
            tone = widget.tone
        } else {
            title = statusBarView.title
            tone = .neutral
        }
        statusPopoverView.present(
            title: title,
            detail: detail,
            tone: tone,
            at: statusBarView.convert(anchor, to: self),
            within: bounds
        )
    }

    private func select(_ index: Int) {
        guard (0..<activeCount).contains(index) else { return }
        selectedIndex = index
        updateSelection()
    }

    private func beginSpatialDrag(for tile: TerminalTileView, event: NSEvent) {
        guard currentWorkspace != nil,
              focusedIndex == nil,
              !isTransitioning,
              !isPeeking,
              presentedOverlay == nil,
              commandPalette == nil
        else { return }
        // A workspace is an execution location, so terminals only reorder
        // inside their existing workspace. Workspace cards remain reorderable.
        spatialDrag = SpatialDrag(
            item: .terminal(tile.session.id),
            startWindowPoint: event.locationInWindow
        )
    }

    private func beginSpatialDrag(for cluster: WorkspaceClusterView, event: NSEvent) {
        guard currentWorkspace == nil,
              focusedIndex == nil,
              !isTransitioning,
              !isPeeking,
              presentedOverlay == nil,
              commandPalette == nil
        else { return }
        spatialDrag = SpatialDrag(
            item: .workspace(cluster.workspaceID),
            startWindowPoint: event.locationInWindow
        )
    }

    private func updateSpatialDrag(with event: NSEvent) {
        guard var spatialDrag else { return }
        let deltaX = event.locationInWindow.x - spatialDrag.startWindowPoint.x
        let deltaY = event.locationInWindow.y - spatialDrag.startWindowPoint.y
        guard spatialDrag.didMove || hypot(deltaX, deltaY) >= 5 else { return }
        let scenePoint = pointInScene(for: event)
        if !spatialDrag.didMove {
            spatialDrag.didMove = true
            self.spatialDrag = spatialDrag
            beginDragGhost(for: spatialDrag.item)
            setDraggedItemAlpha(spatialDrag.item, alpha: 0.26)
        }
        moveDragGhost(to: scenePoint)
        updateDragTarget(at: scenePoint, for: spatialDrag.item)
    }

    @discardableResult
    private func endSpatialDrag(with event: NSEvent) -> Bool {
        guard let spatialDrag else { return false }
        self.spatialDrag = nil
        defer {
            setDraggedItemAlpha(spatialDrag.item, alpha: 1)
            clearDragTarget()
            discardDragGhost()
        }
        guard spatialDrag.didMove else { return false }
        let point = pointInScene(for: event)
        switch spatialDrag.item {
        case let .workspace(workspaceID):
            guard currentWorkspace == nil,
                  let source = workspaceClusters.firstIndex(where: { $0.workspaceID == workspaceID }),
                  let target = nearestWorkspaceIndex(to: point)
            else { return true }
            reorderWorkspace(from: source, to: target)
        case let .terminal(terminalID):
            guard let tile = allSessionTiles.first(where: { $0.session.id == terminalID }),
                  let workspaceID = currentWorkspace,
                  let source = activeSessionTiles.firstIndex(where: { $0 === tile }),
                  let target = nearestTerminalIndex(to: point, in: workspaceID)
            else { return true }
            reorderTerminal(in: workspaceID, from: source, to: target)
        }
        return true
    }

    private func pointInScene(for event: NSEvent) -> NSPoint {
        let deckPoint = convert(event.locationInWindow, from: nil)
        return sceneView.convert(deckPoint, from: self)
    }

    private func updateDragTarget(at point: NSPoint, for item: SpatialDragItem) {
        switch item {
        case .workspace:
            let target = nearestWorkspaceIndex(to: point).flatMap { workspaceClusters[$0] }
            setDragTarget(workspace: target)
        case .terminal:
            setDragTarget(workspace: nil)
            let target = currentWorkspace.flatMap { workspaceID in
                nearestTerminalIndex(to: point, in: workspaceID).map { activeSessionTiles[$0] }
            }
            setDragTarget(tile: target)
        }
    }

    private func nearestWorkspaceIndex(to point: NSPoint) -> Int? {
        workspaceClusters.indices.min { lhs, rhs in
            squaredDistance(point, from: center(of: workspaceClusters[lhs].frame))
                < squaredDistance(point, from: center(of: workspaceClusters[rhs].frame))
        }
    }

    private func nearestTerminalIndex(to point: NSPoint, in workspaceID: String) -> Int? {
        guard let cluster = workspaceCluster(named: workspaceID) else { return nil }
        let sessions = activeSessionTiles
        return sessions.indices.min { lhs, rhs in
            let left = cluster.frameForSession(sessions[lhs], in: sceneView).map(center(of:)) ?? .zero
            let right = cluster.frameForSession(sessions[rhs], in: sceneView).map(center(of:)) ?? .zero
            return squaredDistance(point, from: left) < squaredDistance(point, from: right)
        }
    }

    private func center(of rect: NSRect) -> NSPoint {
        NSPoint(x: rect.midX, y: rect.midY)
    }

    private func squaredDistance(_ point: NSPoint, from center: NSPoint) -> CGFloat {
        let deltaX = point.x - center.x
        let deltaY = point.y - center.y
        return deltaX * deltaX + deltaY * deltaY
    }

    private func beginDragGhost(for item: SpatialDragItem) {
        guard case let .terminal(terminalID) = item,
              let tile = allSessionTiles.first(where: { $0.session.id == terminalID }),
              let image = terminalSnapshot(of: tile)
        else { return }

        let ghost = NSImageView(frame: tile.convert(tile.bounds, to: sceneView))
        ghost.image = image
        ghost.imageScaling = .scaleAxesIndependently
        ghost.alphaValue = 0.94
        ghost.wantsLayer = true
        ghost.layer?.cornerRadius = 7
        ghost.layer?.masksToBounds = true
        sceneView.addSubview(ghost, positioned: .above, relativeTo: nil)
        dragGhost = ghost
    }

    private func moveDragGhost(to point: NSPoint) {
        guard let dragGhost else { return }
        var frame = dragGhost.frame
        frame.origin = NSPoint(x: point.x - frame.width / 2, y: point.y - frame.height / 2)
        dragGhost.frame = frame.integral
    }

    private func finishDragGhost(at destination: NSRect) {
        guard let dragGhost else { return }
        self.dragGhost = nil
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            dragGhost.animator().frame = destination
            dragGhost.animator().alphaValue = 0
        } completionHandler: {
            Task { @MainActor in
                dragGhost.removeFromSuperview()
            }
        }
    }

    private func discardDragGhost() {
        dragGhost?.removeFromSuperview()
        dragGhost = nil
    }

    private func setDraggedItemAlpha(_ item: SpatialDragItem, alpha: CGFloat) {
        switch item {
        case let .workspace(workspaceID):
            workspaceCluster(named: workspaceID)?.alphaValue = alpha
        case let .terminal(terminalID):
            allSessionTiles.first(where: { $0.session.id == terminalID })?.alphaValue = alpha
        }
    }

    private func setDragTarget(tile: TerminalTileView?) {
        guard dragTargetTile !== tile else { return }
        dragTargetTile?.isActivated = false
        dragTargetTile = tile
        dragTargetTile?.isActivated = true
    }

    private func setDragTarget(workspace: WorkspaceClusterView?) {
        guard dragTargetWorkspace !== workspace else { return }
        dragTargetWorkspace?.isDragTarget = false
        dragTargetWorkspace = workspace
        dragTargetWorkspace?.isDragTarget = true
    }

    private func clearDragTarget() {
        dragTargetTile?.isActivated = false
        dragTargetTile = nil
        dragTargetWorkspace?.isDragTarget = false
        dragTargetWorkspace = nil
    }

    private func reorderWorkspace(from source: Int, to target: Int) {
        guard source != target,
              workspaceClusters.indices.contains(source),
              workspaces.indices.contains(source)
        else { return }
        let workspace = workspaces.remove(at: source)
        workspaces.insert(workspace, at: target)
        rebuildWorkspaceClusters()
        selectedIndex = target
        updateWorldGeometry()
        setCameraImmediately()
        updateSelection()
        saveSessions()
        emitAPIEvent("workspace.moved", data: workspaceJSON(workspace))
    }

    private func terminalSnapshot(of tile: TerminalTileView) -> NSImage? {
        viewSnapshot(of: tile)
    }

    private func viewSnapshot(of view: NSView) -> NSImage? {
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let image = NSImage(size: bitmap.size)
        image.addRepresentation(bitmap)
        return image
    }

    private func paneRemovalSnapshot(of view: NSView) -> NSImageView? {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              !view.bounds.isEmpty,
              let image = viewSnapshot(of: view)
        else { return nil }

        let snapshot = NSImageView(frame: view.convert(view.bounds, to: self).integral)
        snapshot.identifier = NSUserInterfaceItemIdentifier("pane-close-animation")
        snapshot.image = image
        snapshot.imageScaling = .scaleAxesIndependently
        snapshot.wantsLayer = true
        snapshot.layer?.cornerRadius = 7
        snapshot.layer?.masksToBounds = true
        addSubview(snapshot, positioned: .below, relativeTo: statusBarView)
        return snapshot
    }

    private func finishPaneRemoval(
        snapshot: NSImageView?,
        previousFrames: [(tile: TerminalTileView, frame: NSRect)] = []
    ) {
        let cameraTarget = currentCameraBounds()
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        guard !reduceMotion else {
            snapshot?.removeFromSuperview()
            moveCamera(to: cameraTarget, duration: 0)
            return
        }

        let reflows = previousFrames.compactMap { previous -> (TerminalTileView, NSRect)? in
            guard previous.tile.superview != nil else { return nil }
            let destination = previous.tile.frame
            previous.tile.frame = previous.frame
            return (previous.tile, destination)
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = Motion.paneCloseDuration
            context.allowsImplicitAnimation = true
            if let snapshot {
                let horizontalInset = snapshot.frame.width * (1 - Motion.paneCloseScale) / 2
                let verticalInset = snapshot.frame.height * (1 - Motion.paneCloseScale) / 2
                snapshot.animator().frame = snapshot.frame.insetBy(
                    dx: horizontalInset,
                    dy: verticalInset
                )
                snapshot.animator().alphaValue = 0
            }
            for (tile, destination) in reflows {
                tile.animator().frame = destination
            }
        } completionHandler: {
            Task { @MainActor in
                snapshot?.removeFromSuperview()
            }
        }
        moveCamera(to: cameraTarget, duration: Motion.paneCloseDuration)
    }

    private func reorderTerminal(in workspaceID: String, from source: Int, to target: Int) {
        var sessions = activeSessionTiles
        guard source != target, sessions.indices.contains(source), sessions.indices.contains(target) else {
            return
        }
        let moved = sessions.remove(at: source)
        sessions.insert(moved, at: target)
        let unaffected = allSessionTiles
        allSessionTiles = workspaces.flatMap { workspace in
            workspace.id == workspaceID
                ? sessions
                : unaffected.filter { $0.session.workspaceID == workspace.id }
        }
        selectedIndex = target
        updateWorldGeometry()
        setCameraImmediately()
        if let destinationFrame = workspaceCluster(named: workspaceID)?.frameForSession(moved, in: sceneView) {
            finishDragGhost(at: destinationFrame)
        }
        updateSelection()
        saveSessions()
        emitAPIEvent("tile.moved", data: tileJSON(moved))
    }

    private func updateSelection() {
        for (index, cluster) in workspaceClusters.enumerated() {
            cluster.isSelected = currentWorkspace == nil && index == selectedIndex
            cluster.isEntered = cluster.workspaceID == currentWorkspace
        }
        let sessions = activeSessionTiles
        let focusedTile = focusedIndex.flatMap { index in
            sessions.indices.contains(index) ? sessions[index] : nil
        }
        for tile in allSessionTiles {
            tile.isSelected = false
            tile.isFocused = tile === focusedTile
        }
        if currentWorkspace != nil, sessions.indices.contains(selectedIndex) {
            sessions[selectedIndex].isSelected = true
        } else if currentWorkspace == nil,
                  workspaceClusters.indices.contains(selectedIndex),
                  workspaceClusters[selectedIndex].sessions.count == 1
        {
            workspaceClusters[selectedIndex].sessions[0].isSelected = true
        }
        needsDisplay = true
        refreshStatusBar()
        // Camera motion is cosmetic. Keep AppKit's responder chain in lockstep
        // with the logical focused tile before, during, and after a zoom.
        restoreInputFocus()
        emitAPIEvent("ui.changed", data: uiJSON())
    }

    private func moveSelection(horizontal: Int, vertical: Int) {
        guard activeCount > 0 else { return }
        clearLabelBuffer()
        let columns = activeColumns
        let row = selectedIndex / columns + vertical
        let column = selectedIndex % columns + horizontal
        guard row >= 0, column >= 0, column < columns else { return }
        let target = row * columns + column
        guard target < activeCount else { return }
        select(target)
    }

    private func reorderSelection(horizontal: Int, vertical: Int) {
        guard focusedIndex == nil, !isTransitioning, !isPeeking, activeCount > 1 else { return }
        let columns = activeColumns
        let row = selectedIndex / columns + vertical
        let column = selectedIndex % columns + horizontal
        guard row >= 0, column >= 0, column < columns else { return }
        let target = row * columns + column
        guard target < activeCount else { return }

        if currentWorkspace == nil {
            workspaceClusters.swapAt(selectedIndex, target)
            workspaces.swapAt(selectedIndex, target)
            let workspaceOrder = workspaceClusters.map(\.workspaceID)
            allSessionTiles = workspaceOrder.flatMap { workspaceID in
                allSessionTiles.filter { $0.session.workspaceID == workspaceID }
            }
        } else {
            let workspaceIndexes = allSessionTiles.indices.filter {
                allSessionTiles[$0].session.workspaceID == currentWorkspace
            }
            guard workspaceIndexes.indices.contains(selectedIndex), workspaceIndexes.indices.contains(target) else {
                return
            }
            allSessionTiles.swapAt(workspaceIndexes[selectedIndex], workspaceIndexes[target])
        }
        selectedIndex = target
        updateWorldGeometry()
        setCameraImmediately()
        updateSelection()
        saveSessions()
        if currentWorkspace == nil,
           workspaceClusters.indices.contains(selectedIndex),
           let workspace = workspaces.first(where: {
               $0.id == workspaceClusters[selectedIndex].workspaceID
           })
        {
            emitAPIEvent("workspace.moved", data: workspaceJSON(workspace))
        } else if activeSessionTiles.indices.contains(selectedIndex) {
            emitAPIEvent("tile.moved", data: tileJSON(activeSessionTiles[selectedIndex]))
        }
    }

    private func beginPeek() {
        guard !isTransitioning, !isPeeking, focusedIndex == nil else { return }
        let target: NSRect?
        if currentWorkspace == nil, workspaceClusters.indices.contains(selectedIndex) {
            target = workspaceClusters[selectedIndex].frame.insetBy(dx: -12, dy: -12)
        } else {
            let sessions = activeSessionTiles
            if sessions.indices.contains(selectedIndex),
               let cluster = workspaceCluster(named: currentWorkspace)
            {
                target = cluster.frameForSession(sessions[selectedIndex], in: sceneView)
            } else {
                target = nil
            }
        }
        guard let target else { return }
        clearLabelBuffer()
        isPeeking = true
        peekCameraBounds = sceneView.bounds
        moveCamera(to: cameraBounds(for: target, viewport: bounds), duration: Motion.peekDuration)
    }

    private func endPeek() {
        guard isPeeking, let cameraBounds = peekCameraBounds else { return }
        isPeeking = false
        peekCameraBounds = nil
        moveCamera(to: cameraBounds, duration: Motion.peekDuration)
    }

    /// A terminal card is an identity-bearing live surface even in an overview
    /// preview. Resolve it from the rendered pointer location instead of only
    /// trusting the child hit target, which can be stale while a transformed
    /// scene is settling after a camera move.
    private func focusClickedTile(
        at windowPoint: NSPoint,
        fallback: TerminalTileView,
        animate: Bool = true
    ) {
        guard focusedIndex == nil,
              commandPalette == nil,
              !isPeeking
        else {
            InputRoutingLog.log("deck ignores tile focus focusedIndex=\(String(describing: focusedIndex)) palette=\(commandPalette != nil) peeking=\(isPeeking)")
            return
        }
        let tile = terminalTile(at: windowPoint) ?? fallback
        currentWorkspace = tile.session.workspaceID
        let sessions = activeSessionTiles
        guard let index = sessions.firstIndex(where: { $0 === tile }) else {
            InputRoutingLog.log("deck cannot find clicked tile=\(tile.session.tileID) in active workspace")
            return
        }
        InputRoutingLog.log("deck focuses tile=\(tile.session.tileID) index=\(index) animate=\(animate)")
        selectedIndex = index
        focusedIndex = index
        clearLabelBuffer()
        updateSelection()
        if animate { moveCamera() }
    }

    private func terminalTile(at windowPoint: NSPoint) -> TerminalTileView? {
        let deckPoint = convert(windowPoint, from: nil)
        let candidates = currentWorkspace == nil ? allSessionTiles : activeSessionTiles
        return candidates.first { tile in
            tile.convert(tile.bounds, to: self).contains(deckPoint)
        }
    }

    private func activate(_ index: Int) {
        guard (0..<activeCount).contains(index), focusedIndex == nil,
              commandPalette == nil, !isTransitioning
        else { return }
        select(index)
        clearLabelBuffer()

        if currentWorkspace == nil {
            let cluster = workspaceClusters[index]
            currentWorkspace = cluster.workspaceID
            selectedIndex = 0
            if cluster.sessions.count == 1 {
                focusedIndex = 0
            }
            updateSelection()
            moveCamera()
        } else {
            focusedIndex = index
            updateSelection()
            moveCamera()
        }
    }

    private func showWorkspaceDeck(completion: (@MainActor () -> Void)? = nil) {
        guard let workspace = currentWorkspace, focusedIndex == nil, !isTransitioning else { return }
        selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspace } ?? 0
        currentWorkspace = nil
        updateSelection()
        moveCamera(completion: completion)
    }

    private func leaveFocusedSession() {
        guard focusedIndex != nil, !isTransitioning else { return }
        let wasSingleton = activeSessionTiles.count == 1
        focusedIndex = nil
        if wasSingleton, let workspace = currentWorkspace {
            selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspace } ?? 0
            currentWorkspace = nil
        }
        updateSelection()
        moveCamera()
    }

    func toggleOverview() {
        if commandPalette != nil {
            dismissCommandPalette()
            if focusedIndex != nil { leaveFocusedSession() }
            return
        }
        guard !isTransitioning, !isPeeking else { return }
        if focusedIndex != nil {
            leaveFocusedSession()
        } else {
            activate(selectedIndex)
        }
    }

    private func appendLabelCharacter(_ character: String) {
        NSObject.cancelPreviousPerformRequests(
            withTarget: self,
            selector: #selector(clearLabelBufferAfterDelay),
            object: nil
        )
        labelBuffer += character
        applyLabelBuffer()
        perform(#selector(clearLabelBufferAfterDelay), with: nil, afterDelay: 1.2)
    }

    private func removeLastLabelCharacter() {
        guard !labelBuffer.isEmpty else { return }
        labelBuffer.removeLast()
        applyLabelBuffer()
    }

    private func applyLabelBuffer() {
        guard !labelBuffer.isEmpty else {
            clearLabelBuffer()
            return
        }
        if currentWorkspace == nil {
            let matches = workspaceClusters.indices.filter {
                workspaceClusters[$0].label.hasPrefix(labelBuffer)
            }
            for (index, cluster) in workspaceClusters.enumerated() {
                cluster.alphaValue = matches.contains(index) ? 1 : 0.28
            }
            if let first = matches.first { select(first) }
            if let exact = matches.first(where: { workspaceClusters[$0].label == labelBuffer }) {
                activate(exact)
            }
        } else {
            let sessions = activeSessionTiles
            let matches = sessions.indices.filter { sessions[$0].session.label.hasPrefix(labelBuffer) }
            for (index, tile) in sessions.enumerated() {
                tile.alphaValue = matches.contains(index) ? 1 : 0.28
            }
            if let first = matches.first { select(first) }
            if let exact = matches.first(where: { sessions[$0].session.label == labelBuffer }) {
                activate(exact)
            }
        }
        needsDisplay = true
    }

    private func clearLabelBuffer() {
        labelBuffer = ""
        for cluster in workspaceClusters { cluster.alphaValue = 1 }
        for tile in allSessionTiles { tile.alphaValue = 1 }
        needsDisplay = true
    }

    @objc private func clearLabelBufferAfterDelay() {
        clearLabelBuffer()
    }

    func toggleCommandPalette() {
        guard presentedOverlay == nil else { return }
        if commandPalette != nil {
            let wasCommands = paletteKind == .commands
            dismissCommandPalette()
            if wasCommands { return }
        }
        guard !isTransitioning, !isPeeking else { return }

        let context = selectedWorkspace().map { "workspace: \($0)" } ?? "workspaces"
        let palette = CommandPaletteView(
            frame: bounds,
            context: context,
            commands: workspacePaletteCommands()
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            self?.runPaletteCommand(command, from: palette)
        }
        commandPalette = palette
        paletteKind = .commands
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func showNewItemPalette() {
        guard presentedOverlay == nil, !isTransitioning, !isPeeking else { return }
        if commandPalette != nil { dismissCommandPalette() }

        let suggestedWorkspaceID = selectedWorkspaceID()
        var commands = [
            PaletteCommand(id: .newWorkspace, title: "New workspace…", shortcut: "choose location"),
        ]
        commands.append(contentsOf: workspaces.map { workspace in
            PaletteCommand(
                id: .newTerminalInWorkspace,
                title: "New terminal in \(workspace.name)",
                shortcut: workspace.id == suggestedWorkspaceID
                    ? "current · \(workspace.location.displayName)"
                    : workspace.location.displayName,
                workspaceID: workspace.id
            )
        })
        let suggestedIndex = suggestedWorkspaceID.flatMap { workspaceID in
            commands.firstIndex(where: { $0.workspaceID == workspaceID })
        } ?? 0
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW",
            context: "choose what and where",
            placeholder: "Create a workspace or choose an existing workspace…",
            defaultFooter: "Nothing is created until you choose an action",
            commands: commands,
            initialSelectedIndex: suggestedIndex
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .newWorkspace:
                self.showNewWorkspaceLocationPalette()
            case .newTerminalInWorkspace:
                guard let workspaceID = command.workspaceID,
                      let workspace = self.workspaces.first(where: { $0.id == workspaceID })
                else {
                    palette?.showStatus("That workspace no longer exists")
                    return
                }
                self.dismissCommandPalette()
                self.createPersistentSession(
                    workspace: workspace.name,
                    name: self.nextAvailableSessionName(base: "shell", workspace: workspace.name),
                    command: nil,
                    workingDirectory: workspace.workingDirectory
                )
            default:
                palette?.showStatus("That action is not available")
            }
        }
        commandPalette = palette
        paletteKind = .newItem
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    func toggleNewTerminalPalette() {
        guard presentedOverlay == nil else { return }
        if commandPalette != nil {
            let wasNewTerminal = paletteKind == .newTerminal
            dismissCommandPalette()
            if wasNewTerminal { return }
        }
        guard !isTransitioning, !isPeeking else { return }
        let workspaceRecord = selectedWorkspaceRecord()
        let workspace = workspaceRecord?.name ?? "workspace"
        let workingDirectory = workspaceRecord?.workingDirectory
            ?? FileManager.default.homeDirectoryForCurrentUser.path
        showNewTerminalPalette(workspace: workspace, workingDirectory: workingDirectory)
    }

    private func showNewTerminalPalette(workspace: String, workingDirectory: String) {
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW TERMINAL",
            context: "workspace: \(workspace)",
            placeholder: "What should this terminal run?",
            defaultFooter: "New sessions use the selected workspace by default",
            commands: [
                PaletteCommand(id: .createShell, title: "New login shell", shortcut: "$SHELL -l"),
                PaletteCommand(id: .runCommand, title: "Run command…", shortcut: ">"),
                PaletteCommand(id: .chooseProject, title: "New workspace from folder…", shortcut: "⇧⌘O"),
            ]
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            self?.runNewTerminalCommand(
                command,
                workspace: workspace,
                workingDirectory: workingDirectory,
                from: palette
            )
        }
        commandPalette = palette
        paletteKind = .newTerminal
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func runNewTerminalCommand(
        _ command: PaletteCommand,
        workspace: String,
        workingDirectory: String,
        from palette: CommandPaletteView?
    ) {
        switch command.id {
        case .createShell:
            dismissCommandPalette()
            createPersistentSession(
                workspace: workspace,
                name: nextAvailableSessionName(base: "shell", workspace: workspace),
                command: nil,
                workingDirectory: workingDirectory
            )
        case .runCommand:
            showRunCommandPalette(workspace: workspace, workingDirectory: workingDirectory)
        case .chooseProject:
            chooseAnotherProject()
        default:
            palette?.showStatus("That command is not available in this palette")
        }
    }

    private func showRunCommandPalette(workspace: String, workingDirectory: String) {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "RUN COMMAND",
            context: "workspace: \(workspace)",
            placeholder: "Enter a command…",
            defaultFooter: "return start    esc dismiss",
            commands: [],
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onSubmit = { [weak self] command in
            guard let self else { return }
            self.dismissCommandPalette()
            let executable = command.split(separator: " ").first.map(String.init) ?? "command"
            self.createPersistentSession(
                workspace: workspace,
                name: self.nextAvailableSessionName(base: executable, workspace: workspace),
                command: command,
                workingDirectory: workingDirectory
            )
        }
        commandPalette = palette
        paletteKind = .runCommand
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseAnotherProject() {
        dismissCommandPalette()
        guard let window else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose a project"
        panel.prompt = "Choose Project"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            Task { @MainActor in
                guard response == .OK, let workspace = panel.url?.lastPathComponent,
                      !workspace.isEmpty
                else { return }
                self?.showNewTerminalPalette(
                    workspace: workspace,
                    workingDirectory: panel.url?.path ?? FileManager.default.homeDirectoryForCurrentUser.path
                )
            }
        }
    }

    private func dismissCommandPalette() {
        locationValidationProcess?.terminate()
        locationValidationProcess = nil
        commandPalette?.removeFromSuperview()
        commandPalette = nil
        paletteKind = nil
        restoreInputFocus()
    }

    func focusCurrentContent() {
        restoreInputFocus()
    }

    private func restoreInputFocus() {
        let sessions = activeSessionTiles
        if let focusedIndex,
           sessions.indices.contains(focusedIndex),
           sessions[focusedIndex].focusTerminal()
        {
            InputRoutingLog.log("deck restores terminal focus tile=\(sessions[focusedIndex].session.tileID)")
            return
        }
        InputRoutingLog.log("deck restores deck focus focusedIndex=\(String(describing: focusedIndex))")
        window?.makeFirstResponder(self)
    }

    private func workspacePaletteCommands() -> [PaletteCommand] {
        var commands = [
            PaletteCommand(id: .newWorkspace, title: "New workspace…", shortcut: ""),
        ]
        if selectedWorkspace() != nil {
            commands.append(contentsOf: [
                PaletteCommand(id: .renameWorkspace, title: "Rename workspace…", shortcut: ""),
                PaletteCommand(
                    id: .changeWorkspaceLocation,
                    title: "Change workspace location…",
                    shortcut: ""
                ),
                PaletteCommand(id: .closeWorkspace, title: "Close workspace…", shortcut: ""),
            ])
        }
        return commands
    }

    private func runPaletteCommand(_ command: PaletteCommand, from palette: CommandPaletteView?) {
        switch command.id {
        case .newWorkspace:
            showNewWorkspaceLocationPalette()
        case .renameWorkspace:
            showRenameWorkspacePalette()
        case .changeWorkspaceLocation:
            if let workspaceID = selectedWorkspaceID(),
               allSessionTiles.contains(where: { $0.session.workspaceID == workspaceID })
            {
                palette?.showStatus("Remove this workspace's terminals before changing its location")
            } else {
                chooseWorkspaceLocation()
            }
        case .toggleOverview:
            dismissCommandPalette()
            toggleOverview()
        case .newTerminal:
            dismissCommandPalette()
            toggleNewTerminalPalette()
        case .attachSession, .reconnectSession:
            dismissCommandPalette()
            reconnectSelectedSession()
        case .detachSession:
            dismissCommandPalette()
            detachSelectedSession()
        case .restartSession:
            dismissCommandPalette()
            restartSelectedSession()
        case .stopSession:
            dismissCommandPalette()
            confirmStopSelectedSession()
        case .stopWorkspace:
            dismissCommandPalette()
            confirmStopSelectedWorkspace()
        case .closeSession:
            dismissCommandPalette()
            confirmCloseSelectedSession()
        case .closeWorkspace:
            dismissCommandPalette()
            confirmCloseSelectedWorkspace()
        case .showDiagnostics:
            dismissCommandPalette()
            showDiagnostics()
        default:
            palette?.showStatus("Prototype only · \(command.title)")
        }
    }

    private func showNewWorkspaceLocationPalette() {
        dismissCommandPalette()
        let home = WorkspaceLocation.local(FileManager.default.homeDirectoryForCurrentUser.path)
        let homeWorkspace = workspace(at: home)
        var commands = [
            PaletteCommand(
                id: homeWorkspace == nil ? .useWorkspaceLocation : .openWorkspace,
                title: homeWorkspace.map { "Open \($0.name)" } ?? "Home folder",
                shortcut: home.displayName,
                location: home,
                workspaceID: homeWorkspace?.id
            ),
            PaletteCommand(
                id: .chooseLocalWorkspaceLocation,
                title: "Browse for local folder…",
                shortcut: "local"
            ),
            PaletteCommand(
                id: .chooseRemoteWorkspaceLocation,
                title: "SSH host and remote folder…",
                shortcut: "alias:path"
            ),
        ]
        var seenLocations = Set([canonicalLocationKey(home)])
        for workspace in workspaces.reversed() {
            let location = workspace.location
            guard seenLocations.insert(canonicalLocationKey(location)).inserted else { continue }
            commands.append(PaletteCommand(
                id: .openWorkspace,
                title: "Open \(workspace.name)",
                shortcut: location.displayName,
                location: location,
                workspaceID: workspace.id
            ))
        }

        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW WORKSPACE LOCATION",
            context: "new workspace",
            placeholder: "Where should this workspace live?",
            defaultFooter: "Choose a known location, browse locally, or connect through OpenSSH",
            commands: commands
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .useWorkspaceLocation:
                guard let location = command.location else { return }
                self.continueNewWorkspaceFlow(with: location)
            case .openWorkspace:
                guard let workspaceID = command.workspaceID else { return }
                self.openExistingWorkspace(workspaceID)
            case .chooseLocalWorkspaceLocation:
                self.chooseLocalLocationForNewWorkspace()
            case .chooseRemoteWorkspaceLocation:
                self.showNewRemoteWorkspaceLocationPalette()
            default:
                palette?.showStatus("That location is not available")
            }
        }
        commandPalette = palette
        paletteKind = .newWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseLocalLocationForNewWorkspace() {
        dismissCommandPalette()
        guard let window else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose New Workspace Folder"
        panel.message = "The workspace's terminals, Git status, and services will use this folder."
        panel.prompt = "Use Folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            Task { @MainActor in
                guard let self, response == .OK, let path = panel.url?.path else { return }
                self.continueNewWorkspaceFlow(with: .local(path))
            }
        }
    }

    private func showNewRemoteWorkspaceLocationPalette() {
        dismissCommandPalette()
        let hosts = knownSSHHosts()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW SSH WORKSPACE",
            context: "SSH host",
            placeholder: "Choose an alias or type user@host…",
            defaultFooter: hosts.isEmpty
                ? "Type a host understood by OpenSSH"
                : "Known aliases come from ~/.ssh/config and existing workspaces",
            commands: hosts.map {
                PaletteCommand(id: .useSSHHost, title: $0, shortcut: "SSH", sshHost: $0)
            },
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self] command in
            guard let host = command.sshHost else { return }
            self?.showNewRemoteWorkspacePathPalette(host: host)
        }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self, let host = self.validSSHHost(value) else {
                palette?.showStatus("Enter an OpenSSH alias, host, or user@host")
                return
            }
            self.showNewRemoteWorkspacePathPalette(host: host)
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func showNewRemoteWorkspacePathPalette(host: String) {
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW SSH WORKSPACE",
            context: host,
            placeholder: "~/gh/project or /srv/project",
            defaultFooter: "Enter an existing remote folder; Machinen will verify it over SSH",
            commands: [],
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onSubmit = { [weak self, weak palette] path in
            guard let self, let palette,
                  let location = WorkspaceLocation.parseSSHReference("\(host):\(path)")
            else {
                palette?.showStatus("Use ~/path or an absolute /path")
                return
            }
            palette.showStatus("Checking \(location.displayName)…")
            self.validateRemoteWorkspaceLocation(location) { [weak self, weak palette] result in
                guard let self, let palette, self.commandPalette === palette else { return }
                switch result {
                case let .success(canonicalPath):
                    self.continueNewWorkspaceFlow(
                        with: .ssh(host: host, path: canonicalPath)
                    )
                case let .failure(error):
                    palette.showStatus(error.message)
                }
            }
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func validSSHHost(_ value: String) -> String? {
        WorkspaceLocation.parseSSHReference(
            "\(value.trimmingCharacters(in: .whitespacesAndNewlines)):/"
        )?.sshHost
    }

    private func knownSSHHosts() -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        func append(_ host: String) {
            if seen.insert(host).inserted { result.append(host) }
        }
        for workspace in workspaces {
            if let host = workspace.location.sshHost { append(host) }
        }
        let configURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".ssh/config")
        if let config = try? String(contentsOf: configURL, encoding: .utf8) {
            for rawLine in config.split(whereSeparator: { $0.isNewline }) {
                let line = rawLine.prefix(while: { $0 != "#" })
                let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
                guard fields.first?.lowercased() == "host" else { continue }
                for field in fields.dropFirst() {
                    let host = String(field)
                    if !host.contains(where: { "*?!".contains($0) }) { append(host) }
                }
            }
        }
        return result
    }

    private func canonicalLocationKey(_ location: WorkspaceLocation) -> String {
        switch location.kind {
        case .local:
            let path = URL(fileURLWithPath: location.path)
                .standardizedFileURL
                .resolvingSymlinksInPath()
                .path
            return "local|\(path)"
        case .ssh:
            return "ssh|\(location.sshHost?.lowercased() ?? "")|\(location.path)"
        }
    }

    private func workspace(
        at location: WorkspaceLocation,
        excluding workspaceID: String? = nil
    ) -> WorkspaceRecord? {
        let key = canonicalLocationKey(location)
        return workspaces.first {
            $0.id != workspaceID && canonicalLocationKey($0.location) == key
        }
    }

    private func continueNewWorkspaceFlow(with requestedLocation: WorkspaceLocation) {
        do {
            let location = try validatedWorkspaceLocation(requestedLocation)
            if let existing = workspace(at: location) {
                openExistingWorkspace(existing.id)
            } else {
                showNewWorkspaceNamePalette(location: location)
            }
        } catch {
            presentWorkspaceLocationError(error)
        }
    }

    private func openExistingWorkspace(_ workspaceID: String) {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else { return }
        dismissCommandPalette()
        let sessions = activeSessionTiles(for: workspaceID)
        if sessions.isEmpty {
            createPersistentSession(
                workspace: workspace.name,
                name: "shell",
                command: nil,
                workingDirectory: workspace.workingDirectory
            )
            return
        }
        currentWorkspace = workspaceID
        selectedIndex = 0
        focusedIndex = nil
        updateWorldGeometry()
        updateSelection()
        moveCamera()
    }

    private func showNewWorkspaceNamePalette(location: WorkspaceLocation) {
        dismissCommandPalette()
        let suggestedName = nextAvailableWorkspaceName(base: locationName(location))
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NAME NEW WORKSPACE",
            context: location.displayName,
            placeholder: "Enter a name…",
            defaultFooter: "The suggested name is selected · type to replace it · esc dismiss",
            commands: [],
            acceptsFreeform: true,
            initialQuery: suggestedName
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onSubmit = { [weak self, weak palette] name in
            guard let self else { return }
            guard !self.workspaceNameExists(name) else {
                palette?.showStatus("A workspace named \(name) already exists")
                return
            }
            do {
                try self.createNewWorkspace(name: name, location: location)
            } catch {
                palette?.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
            }
        }
        commandPalette = palette
        paletteKind = .newWorkspace
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func locationName(_ location: WorkspaceLocation) -> String {
        let name = URL(fileURLWithPath: location.path).lastPathComponent
        if !name.isEmpty { return name }
        return location.sshHost ?? "workspace"
    }

    private func createNewWorkspace(name: String, location: WorkspaceLocation) throws {
        guard !workspaceNameExists(name) else {
            throw MachinenAPIError("workspace_name_conflict", "A workspace named \(name) already exists")
        }
        let location = try validatedWorkspaceLocation(location)
        guard workspace(at: location) == nil else {
            throw MachinenAPIError(
                "workspace_location_conflict",
                "That location already belongs to another workspace"
            )
        }
        dismissCommandPalette()
        createPersistentSession(
            workspace: name,
            name: "shell",
            command: nil,
            workingDirectory: location.path,
            location: location
        )
    }

    private func showRenameWorkspacePalette() {
        guard let workspaceID = selectedWorkspaceID(),
              let workspace = workspaces.first(where: { $0.id == workspaceID })
        else { return }
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "RENAME WORKSPACE",
            context: workspace.name,
            placeholder: "Enter a new name…",
            defaultFooter: "Names must be non-empty and unique    esc dismiss",
            commands: [],
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onSubmit = { [weak self, weak palette] name in
            guard let self,
                  let workspace = self.workspaces.first(where: { $0.id == workspaceID })
            else { return }
            guard !self.workspaceNameExists(name, excluding: workspaceID) else {
                palette?.showStatus("A workspace named \(name) already exists")
                return
            }
            workspace.name = name
            for tile in self.allSessionTiles where tile.session.workspaceID == workspaceID {
                tile.session.workspace = name
            }
            self.dismissCommandPalette()
            self.rebuildWorkspaceClusters()
            self.updateSelection()
            self.saveSessions()
            self.emitAPIEvent("workspace.updated", data: self.workspaceJSON(workspace))
        }
        commandPalette = palette
        paletteKind = .renameWorkspace
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseWorkspaceLocation() {
        guard let workspaceID = selectedWorkspaceID(),
              let workspace = workspaces.first(where: { $0.id == workspaceID })
        else { return }
        dismissCommandPalette()

        let palette = CommandPaletteView(
            frame: bounds,
            heading: "WORKSPACE LOCATION",
            context: workspace.location.displayName,
            placeholder: "Choose where this workspace runs…",
            defaultFooter: "Local folders run here · remote folders run through SSH",
            commands: [
                PaletteCommand(
                    id: .chooseLocalWorkspaceLocation,
                    title: "Local folder…",
                    shortcut: workspace.location.kind == .local ? "current" : ""
                ),
                PaletteCommand(
                    id: .chooseRemoteWorkspaceLocation,
                    title: "Remote folder over SSH…",
                    shortcut: workspace.location.sshHost ?? "host:path"
                ),
            ]
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            guard let self else { return }
            switch command.id {
            case .chooseLocalWorkspaceLocation:
                self.chooseLocalWorkspaceLocation(workspaceID: workspaceID)
            case .chooseRemoteWorkspaceLocation:
                self.showRemoteWorkspaceLocationPalette(workspaceID: workspaceID)
            default:
                palette?.showStatus("That location type is not available")
            }
        }
        commandPalette = palette
        paletteKind = .workspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func chooseLocalWorkspaceLocation(workspaceID: String) {
        let previousLocation = workspaces.first(where: { $0.id == workspaceID })?.location
        dismissCommandPalette()
        guard let window else { return }

        let panel = NSOpenPanel()
        panel.title = "Choose Local Workspace Folder"
        panel.message = "New and restarted terminals will use this folder. Running processes are not moved."
        panel.prompt = "Use Folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        if previousLocation?.kind == .local, let path = previousLocation?.path {
            panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true)
        }
        panel.beginSheetModal(for: window) { [weak self] response in
            Task { @MainActor in
                guard let self, response == .OK, let path = panel.url?.path else { return }
                do {
                    try self.applyWorkspaceLocation(
                        workspaceID: workspaceID,
                        location: .local(path)
                    )
                } catch {
                    self.presentWorkspaceLocationError(error)
                }
            }
        }
    }

    private func showRemoteWorkspaceLocationPalette(workspaceID: String) {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else { return }
        dismissCommandPalette()
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "REMOTE WORKSPACE",
            context: workspace.name,
            placeholder: "mini:~/project or user@host:/project",
            defaultFooter: "The host may be an alias from ~/.ssh/config; the folder must already exist",
            commands: [],
            acceptsFreeform: true
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onSubmit = { [weak self, weak palette] value in
            guard let self, let palette,
                  let location = WorkspaceLocation.parseSSHReference(value),
                  let host = location.sshHost
            else {
                palette?.showStatus("Use alias:/absolute/path, alias:~/path, or ssh://user@host/path")
                return
            }
            palette.showStatus("Checking \(location.displayName)…")
            self.validateRemoteWorkspaceLocation(location) { [weak self, weak palette] result in
                guard let self, let palette, self.commandPalette === palette else { return }
                switch result {
                case let .success(canonicalPath):
                    do {
                        try self.applyWorkspaceLocation(
                            workspaceID: workspaceID,
                            location: .ssh(host: host, path: canonicalPath)
                        )
                        self.dismissCommandPalette()
                    } catch {
                        palette.showStatus((error as? MachinenAPIError)?.message ?? error.localizedDescription)
                    }
                case let .failure(error):
                    palette.showStatus(error.message)
                }
            }
        }
        commandPalette = palette
        paletteKind = .remoteWorkspaceLocation
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func validateRemoteWorkspaceLocation(
        _ location: WorkspaceLocation,
        completion: @escaping @MainActor (Result<String, MachinenAPIError>) -> Void
    ) {
        guard let host = location.sshHost else {
            completion(.failure(MachinenAPIError("invalid_params", "An SSH host is required")))
            return
        }
        locationValidationProcess?.terminate()
        let output = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        process.arguments = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=8",
            host,
            "cd -- \(location.remoteShellPath) && /bin/pwd -P",
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = output
        process.terminationHandler = { process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let text = String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            Task { @MainActor in
                if process.terminationStatus == 0, let path = text.split(separator: "\n").last {
                    completion(.success(String(path)))
                } else {
                    completion(.failure(MachinenAPIError(
                        "ssh_unavailable",
                        text.isEmpty ? "SSH could not access that folder" : text
                    )))
                }
            }
        }
        do {
            try process.run()
            locationValidationProcess = process
        } catch {
            completion(.failure(MachinenAPIError("ssh_unavailable", error.localizedDescription)))
        }
    }

    private func applyWorkspaceLocation(
        workspaceID: String,
        location: WorkspaceLocation
    ) throws {
        guard let workspace = workspaces.first(where: { $0.id == workspaceID }) else {
            throw MachinenAPIError("workspace_not_found", "Workspace does not exist")
        }
        try updateWorkspaceLocation(workspace, to: location)
        updateSelection()
        saveSessions()
        emitAPIEvent("workspace.updated", data: workspaceJSON(workspace))
    }

    private func presentWorkspaceLocationError(_ error: Error) {
        guard let window else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Could Not Use Workspace Location"
        alert.informativeText = (error as? MachinenAPIError)?.message ?? error.localizedDescription
        alert.beginSheetModal(for: window)
    }

    private func workspaceNameExists(_ name: String, excluding workspaceID: String? = nil) -> Bool {
        workspaces.contains { $0.id != workspaceID && $0.name == name }
    }

    private func presentConfirmation(
        heading: String,
        message: String,
        consequence: String,
        confirmTitle: String,
        action: @escaping @MainActor () -> Void
    ) {
        let confirmation = ActionConfirmationView(
            frame: bounds,
            heading: heading,
            message: message,
            consequence: consequence,
            confirmTitle: confirmTitle
        )
        confirmation.layer?.zPosition = 2_000
        confirmation.onCancel = { [weak self] in
            self?.dismissPresentedOverlay()
        }
        confirmation.onConfirm = { [weak self] in
            self?.dismissPresentedOverlay()
            action()
        }
        presentedOverlay = confirmation
        addSubview(confirmation, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(confirmation)
    }

    private func dismissPresentedOverlay() {
        presentedOverlay?.removeFromSuperview()
        presentedOverlay = nil
        restoreInputFocus()
    }

    private func confirmStopSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        presentConfirmation(
            heading: "Stop session \(tile.session.name)?",
            message: "This terminates the process in this terminal. The workspace and its other sessions keep running.",
            consequence: "Unsaved input in the process may be lost. The stopped session remains visible and can be restarted.",
            confirmTitle: "Stop session"
        ) { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.stopSession(tile)
        }
    }

    private func confirmStopSelectedWorkspace() {
        guard let workspace = selectedWorkspace() else { return }
        let count = allSessionTiles.count { $0.session.workspace == workspace }
        presentConfirmation(
            heading: "Stop workspace \(workspace)?",
            message: "This stops all \(count) terminal \(count == 1 ? "process" : "processes") grouped in this workspace.",
            consequence: "The workspace and terminal definitions remain. Each terminal can be restarted later.",
            confirmTitle: "Stop workspace"
        ) { [weak self] in
            self?.stopWorkspace(workspace)
        }
    }

    private func confirmCloseSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        presentConfirmation(
            heading: "Close terminal \(tile.session.name)?",
            message: "This terminates its process and removes the terminal from \(tile.session.workspace).",
            consequence: "Files in its working directory are not deleted.",
            confirmTitle: "Close terminal"
        ) { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.closeSession(tile)
        }
    }

    private func confirmCloseSelectedWorkspace() {
        guard let workspace = selectedWorkspace() else { return }
        let count = allSessionTiles.count { $0.session.workspace == workspace }
        presentConfirmation(
            heading: "Close workspace \(workspace)?",
            message: "This terminates \(count) terminal \(count == 1 ? "process" : "processes") and removes the workspace from Machinen.",
            consequence: "Files in the terminals' working directories are not deleted.",
            confirmTitle: "Close workspace"
        ) { [weak self] in
            self?.closeWorkspace(workspace)
        }
    }

    private func detachSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(to: .detached, terminalText: tile.session.terminalText)
        tile.detachTerminalViewer()
        saveSessions()
        emitAPIEvent("tile.viewerChanged", data: tileJSON(tile))
        if focusedIndex != nil {
            leaveFocusedSession()
        }
    }

    private func reconnectSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(to: .starting, terminalText: tile.session.terminalText)
        tile.attachTerminal()
        saveSessions()
        emitAPIEvent("tile.viewerChanged", data: tileJSON(tile))
    }

    private func restartSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(to: .starting, terminalText: tile.session.terminalText)
        tile.restartTerminal()
        saveSessions()
    }

    private func stopSession(_ tile: TerminalTileView) {
        tile.stopTerminal()
        tile.transition(to: .stopped, terminalText: tile.session.terminalText)
        saveSessions()
    }

    private func stopWorkspace(_ workspace: String) {
        for tile in allSessionTiles where tile.session.workspace == workspace {
            tile.stopTerminal()
            tile.transition(to: .stopped, terminalText: tile.session.terminalText)
        }
        saveSessions()
    }

    private func bufferCloseSession(_ tile: TerminalTileView) {
        guard let position = allSessionTiles.firstIndex(where: { $0 === tile }) else { return }
        let workspaceID = tile.session.workspaceID
        let deadline = Date().addingTimeInterval(closeGracePeriod)
        tile.session.pendingCloseDeadline = deadline
        tile.session.pendingClosePosition = position
        recentlyClosedTerminals[tile.session.id] = RecentlyClosedTerminal(
            tile: tile,
            position: position,
            deadline: deadline
        )

        tile.removeFromSuperview()
        allSessionTiles.remove(at: position)
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
            focusedIndex = activeSessionTiles.isEmpty ? nil : min(focusedIndex ?? selectedIndex, activeSessionTiles.count - 1)
        }
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        schedulePendingCloseFinalization(terminalID: tile.session.id)
        refreshUndoCloseView()
        emitAPIEvent("tile.closed", data: tileJSON(tile))

        if recentlyClosedTerminals.count > recentlyClosedLimit,
           let oldest = recentlyClosedTerminals.values.min(by: { $0.deadline < $1.deadline })
        {
            finalizePendingClose(terminalID: oldest.tile.session.id)
        }
    }

    var canReopenClosedTerminal: Bool { !recentlyClosedTerminals.isEmpty }

    func reopenLastClosedTerminal() {
        guard let closed = recentlyClosedTerminals.values.max(by: { $0.deadline < $1.deadline }) else { return }
        let terminalID = closed.tile.session.id
        guard workspaces.contains(where: { $0.id == closed.tile.session.workspaceID }) else {
            finalizePendingClose(terminalID: terminalID)
            return
        }
        recentlyClosedTerminals.removeValue(forKey: terminalID)
        pendingCloseTasks.removeValue(forKey: terminalID)?.cancel()
        closed.tile.session.pendingCloseDeadline = nil
        closed.tile.session.pendingClosePosition = nil
        let insertion = min(max(0, closed.position), allSessionTiles.count)
        allSessionTiles.insert(closed.tile, at: insertion)
        rebuildWorkspaceClusters()
        currentWorkspace = closed.tile.session.workspaceID
        let workspaceTiles = activeSessionTiles
        selectedIndex = workspaceTiles.firstIndex(where: { $0 === closed.tile }) ?? 0
        focusedIndex = selectedIndex
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        refreshUndoCloseView()
        emitAPIEvent("tile.reopened", data: tileJSON(closed.tile))
    }

    func terminateLastClosedTerminalNow() {
        guard let closed = recentlyClosedTerminals.values.max(by: { $0.deadline < $1.deadline }) else { return }
        finalizePendingClose(terminalID: closed.tile.session.id)
    }

    private func schedulePendingCloseFinalization(terminalID: String) {
        pendingCloseTasks.removeValue(forKey: terminalID)?.cancel()
        guard let closed = recentlyClosedTerminals[terminalID] else { return }
        let task = DispatchWorkItem { [weak self] in
            self?.finalizePendingClose(terminalID: terminalID)
        }
        pendingCloseTasks[terminalID] = task
        DispatchQueue.main.asyncAfter(
            deadline: .now() + max(0, closed.deadline.timeIntervalSinceNow),
            execute: task
        )
    }

    private func finalizePendingClose(terminalID: String) {
        guard let closed = recentlyClosedTerminals.removeValue(forKey: terminalID) else { return }
        pendingCloseTasks.removeValue(forKey: terminalID)?.cancel()
        refreshUndoCloseView()
        saveSessions()
        emitAPIEvent("tile.closeFinalized", data: tileJSON(closed.tile))
        // The tile is already absent from the scene. Defer renderer teardown so
        // the visible close commits before Ghostty and worker cleanup begin.
        DispatchQueue.main.async {
            closed.tile.removeTerminal()
        }
    }

    private func refreshUndoCloseView() {
        guard let latest = recentlyClosedTerminals.values.max(by: { $0.deadline < $1.deadline }) else {
            undoCloseView?.removeFromSuperview()
            undoCloseView = nil
            return
        }
        let view: UndoTerminalCloseView
        if let current = undoCloseView {
            view = current
        } else {
            view = UndoTerminalCloseView(frame: .zero)
            view.onUndo = { [weak self] in self?.reopenLastClosedTerminal() }
            view.onTerminateNow = { [weak self] in self?.terminateLastClosedTerminalNow() }
            undoCloseView = view
            addSubview(view, positioned: .above, relativeTo: statusBarView)
        }
        view.terminalName = latest.tile.session.name
        view.deadline = latest.deadline
        needsLayout = true
    }

    private func closeSession(_ tile: TerminalTileView) {
        let workspaceID = tile.session.workspaceID
        let removalSnapshot = paneRemovalSnapshot(of: tile)
        let previousFrames = allSessionTiles.compactMap { sibling in
            sibling !== tile && sibling.session.workspaceID == workspaceID
                ? (tile: sibling, frame: sibling.frame)
                : nil
        }
        tile.removeTerminal()
        tile.removeFromSuperview()
        allSessionTiles.removeAll { $0 === tile }
        emitAPIEvent("tile.deleted", data: tileJSON(tile))
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
            focusedIndex = activeSessionTiles.count == 1 ? 0 : nil
        }
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot, previousFrames: previousFrames)
        saveSessions()
    }

    private func closeWorkspace(_ workspace: String) {
        let workspaceRecord = workspaces.first { $0.name == workspace }
        let pendingTerminalIDs = recentlyClosedTerminals.values
            .filter { $0.tile.session.workspace == workspace }
            .map { $0.tile.session.id }
        for terminalID in pendingTerminalIDs {
            finalizePendingClose(terminalID: terminalID)
        }
        let removedTiles = allSessionTiles.filter { $0.session.workspace == workspace }
        let removalView: NSView? = if currentWorkspace == workspaceRecord?.id {
            selectedSessionTile() ?? workspaceCluster(named: workspaceRecord?.id)
        } else {
            workspaceCluster(named: workspaceRecord?.id)
        }
        let removalSnapshot = removalView.flatMap(paneRemovalSnapshot)
        for tile in removedTiles {
            tile.removeTerminal()
            tile.removeFromSuperview()
            emitAPIEvent("tile.deleted", data: tileJSON(tile))
        }
        allSessionTiles.removeAll { $0.session.workspace == workspace }
        if let workspaceID = workspaceRecord?.id {
            workspaceCluster(named: workspaceID)?.removeFromSuperview()
            workspaces.removeAll { $0.id == workspaceID }
        }
        workspaceClusters.removeAll { $0.workspace == workspace }
        rebuildWorkspaceClusters()
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        enterSoleTerminalIfNeeded()
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot)
        saveSessions()
        if let workspaceRecord {
            emitAPIEvent("workspace.deleted", data: [
                "id": workspaceRecord.id,
                "name": workspaceRecord.name,
            ])
        }
    }

    func showDebugInformation() {
        guard presentedOverlay == nil else { return }
        showDiagnostics()
    }

    private func showDiagnostics() {
        guard let workspace = selectedWorkspace() else { return }
        let text: String
        let heading: String
        if currentWorkspace == nil {
            let sessions = allSessionTiles.filter { $0.session.workspace == workspace }
            heading = "WORKSPACE DIAGNOSTICS · \(workspace)"
            let sessionLines = sessions.map {
                "  \($0.session.label)  \($0.session.name.padding(toLength: 12, withPad: " ", startingAt: 0)) \($0.currentState.rawValue)"
            }.joined(separator: "\n")
            text = """
            workspace       \(workspace)
            kind            visual terminal group
            location        \(selectedWorkspaceRecord()?.location.displayName ?? "unknown")
            sessions        \(sessions.count)
            state file      \(sessionStore.manifestURL.path)

            SESSION STATE
            \(sessionLines)

            PERSISTENCE
            Native session workers own terminal commands and journal output in
            SQLite. Machinen restores the scene from the state file above.
            """
        } else if let tile = selectedSessionTile() {
            heading = "SESSION DIAGNOSTICS · \(workspace) / \(tile.session.name)"
            let backendDetail = "The native worker owns this PTY and journals recovery data on \(tile.session.location.sshHost ?? "this Mac")."
            text = """
            workspace       \(workspace)
            session         \(tile.session.name)
            session id      \(tile.session.id)
            backend         \(TerminalSession.backendName)
            state            \(tile.currentState.rawValue)
            viewer           \(tile.currentState == .detached ? "detached" : "attached")
            command          \(launchDescription(tile.session.launch))
            location         \(tile.session.location.displayName)
            state file       \(sessionStore.manifestURL.path)

            PERSISTENCE
            \(backendDetail)
            """
        } else {
            return
        }

        let diagnostics = DiagnosticsView(frame: bounds, heading: heading, text: text)
        diagnostics.layer?.zPosition = 2_000
        diagnostics.onDismiss = { [weak self] in self?.dismissPresentedOverlay() }
        presentedOverlay = diagnostics
        addSubview(diagnostics, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(diagnostics)
    }

    func prepareForTermination() {
        isShuttingDown = true
        for tile in persistedSessionTiles where tile.session.state == .running || tile.session.state == .starting {
            tile.detachTerminalForApplicationExit()
            tile.session.state = .running
        }
        saveSessions()
    }

    func zoomInOneLevel() {
        guard presentedOverlay == nil, commandPalette == nil,
              focusedIndex == nil, !isTransitioning, !isPeeking
        else { return }
        activate(selectedIndex)
    }

    func zoomOutOneLevel() {
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking
        else { return }
        if focusedIndex != nil {
            leaveFocusedSession()
        } else if currentWorkspace != nil {
            showWorkspaceDeck()
        }
    }

    /// `⌘←` and `⌘→` move between terminals in the current workspace while
    /// preserving the scene hierarchy: terminal → workspace → terminal.
    @discardableResult
    func cycleFocusedTerminal(by offset: Int) -> Bool {
        let sessions = activeSessionTiles
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking,
              let focusedIndex, sessions.indices.contains(focusedIndex),
              sessions.count > 1, offset != 0
        else { return false }

        let targetIndex = (focusedIndex + offset % sessions.count + sessions.count)
            % sessions.count
        let targetTileID = sessions[targetIndex].session.tileID
        InputRoutingLog.log(
            "cycles focused terminal tile=\(sessions[focusedIndex].session.tileID)→\(targetTileID)"
        )
        self.focusedIndex = nil
        selectedIndex = targetIndex
        updateSelection()
        moveCamera(duration: Motion.terminalSwitchDuration) { [weak self] in
            self?.focusCycledTerminal(targetTileID)
        }
        return true
    }

    private func focusCycledTerminal(_ tileID: String) {
        guard let targetIndex = activeSessionTiles.firstIndex(where: { $0.session.tileID == tileID })
        else { return }
        selectedIndex = targetIndex
        focusedIndex = targetIndex
        updateSelection()
        moveCamera(duration: Motion.terminalSwitchDuration)
    }

    /// `⌘[` and `⌘]` travel through the complete scene hierarchy to the
    /// previous or next workspace's first terminal: terminal → source
    /// workspace → workspace overview → destination workspace → terminal.
    @discardableResult
    func cycleFocusedWorkspace(by offset: Int) -> Bool {
        let sourceSessions = activeSessionTiles
        guard presentedOverlay == nil, commandPalette == nil,
              !isTransitioning, !isPeeking,
              let focusedIndex, sourceSessions.indices.contains(focusedIndex),
              offset != 0,
              let sourceWorkspaceID = currentWorkspace
        else { return false }

        // Workspaces without tiles remain visible in the overview but cannot
        // be a destination for a shortcut that promises to end in a terminal.
        let destinations = workspaces.filter { workspace in
            allSessionTiles.contains { $0.session.workspaceID == workspace.id }
        }
        guard destinations.count > 1,
              let sourceIndex = destinations.firstIndex(where: { $0.id == sourceWorkspaceID })
        else { return false }

        let targetIndex = (sourceIndex + offset % destinations.count + destinations.count)
            % destinations.count
        let targetWorkspace = destinations[targetIndex]
        guard !activeSessionTiles(for: targetWorkspace.id).isEmpty else { return false }

        InputRoutingLog.log(
            "cycles focused tile workspace=\(sourceWorkspaceID)→\(targetWorkspace.id)"
        )
        self.focusedIndex = nil
        updateSelection()
        moveCamera { [weak self] in
            self?.selectCycledWorkspace(targetWorkspace.id)
        }
        return true
    }

    private func selectCycledWorkspace(_ workspaceID: String) {
        guard let workspaceIndex = workspaceClusters.firstIndex(where: { $0.workspaceID == workspaceID }) else {
            return
        }
        currentWorkspace = nil
        selectedIndex = workspaceIndex
        focusedIndex = nil
        updateSelection()
        moveCamera { [weak self] in
            self?.enterCycledWorkspace(workspaceID)
        }
    }

    private func enterCycledWorkspace(_ workspaceID: String) {
        guard !activeSessionTiles(for: workspaceID).isEmpty else { return }
        currentWorkspace = workspaceID
        selectedIndex = 0
        focusedIndex = nil
        updateSelection()
        moveCamera { [weak self] in
            self?.focusCycledWorkspaceTile(workspaceID)
        }
    }

    private func focusCycledWorkspaceTile(_ workspaceID: String) {
        guard currentWorkspace == workspaceID, !activeSessionTiles.isEmpty else { return }
        selectedIndex = 0
        focusedIndex = 0
        updateSelection()
        moveCamera()
    }

    func createNewWorkspaceOrTerminal() {
        showNewItemPalette()
    }

    func handleCommandW() {
        if presentedOverlay != nil { return }
        if commandPalette != nil {
            dismissCommandPalette()
            return
        }
        guard !isTransitioning, !isPeeking else { return }
        let workspaceCount = selectedWorkspace().map { workspace in
            allSessionTiles.count { $0.session.workspace == workspace }
        } ?? 0
        if currentWorkspace == nil || workspaceCount <= 1 {
            confirmCloseSelectedWorkspace()
        } else if let tile = selectedSessionTile() {
            bufferCloseSession(tile)
        }
    }

    private func nextAvailableWorkspaceName(base requestedBase: String = "workspace") -> String {
        let trimmedBase = requestedBase.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmedBase.isEmpty ? "workspace" : trimmedBase
        let names = Set(workspaces.map(\.name))
        if !names.contains(base) { return base }
        var suffix = 2
        while names.contains("\(base) \(suffix)") {
            suffix += 1
        }
        return "\(base) \(suffix)"
    }

    private func createPersistentSession(
        workspace: String,
        name: String,
        command: String?,
        workingDirectory: String,
        location requestedLocation: WorkspaceLocation? = nil
    ) {
        let workspaceRecord: WorkspaceRecord
        let createdWorkspace: Bool
        if let existing = workspaces.first(where: { $0.name == workspace }) {
            workspaceRecord = existing
            createdWorkspace = false
        } else {
            let location = requestedLocation ?? .local(workingDirectory)
            workspaceRecord = WorkspaceRecord(
                name: workspace,
                workingDirectory: location.path,
                sshHost: location.sshHost
            )
            workspaces.append(workspaceRecord)
            createdWorkspace = true
        }
        let session = TerminalSession(
            label: nextAvailableLabel(workspace: workspace, session: name),
            workspaceID: workspaceRecord.id,
            workspace: workspace,
            name: name,
            launch: command.map(TerminalLaunch.shellCommand) ?? .loginShell,
            workingDirectory: workspaceRecord.workingDirectory,
            sshHost: workspaceRecord.location.sshHost,
            state: .starting
        )
        let tile = TerminalTileView(session: session)
        installTile(tile)
        installPersistentTerminal(in: tile)
        allSessionTiles.append(tile)
        saveSessions()
        rebuildWorkspaceClusters()
        currentWorkspace = workspaceRecord.id
        updateWorldGeometry()
        selectedIndex = max(0, activeSessionTiles.count - 1)
        focusedIndex = selectedIndex
        updateSelection()
        moveCamera()
        if createdWorkspace {
            emitAPIEvent("workspace.created", data: workspaceJSON(workspaceRecord))
        }
        emitAPIEvent("tile.created", data: tileJSON(tile))
    }

    private func nextAvailableSessionName(base: String, workspace: String) -> String {
        let names = Set(allSessionTiles.compactMap {
            $0.session.workspace == workspace ? $0.session.name : nil
        })
        if !names.contains(base) { return base }
        var suffix = 2
        while names.contains("\(base) \(suffix)") {
            suffix += 1
        }
        return "\(base) \(suffix)"
    }

    private func nextAvailableLabel(workspace: String, session: String) -> String {
        let workspacePrefix = workspace.lowercased().first.map(String.init) ?? "w"
        let sessionPrefix = session.lowercased().first.map(String.init) ?? "s"
        let preferred = workspacePrefix + sessionPrefix
        let used = Set(allSessionTiles.map { $0.session.label })
        if !used.contains(preferred) { return preferred }
        for suffix in 2...9 {
            let candidate = workspacePrefix + String(suffix)
            if !used.contains(candidate) { return candidate }
        }
        return workspacePrefix + "x"
    }

    func performAPIOperation(_ operation: String, params: JSONObject) throws -> Any {
        switch operation {
        case "system.snapshot":
            return snapshotJSON()
        case "workspace.list":
            return ["workspaces": workspaces.map(workspaceJSON)]
        case "workspace.get":
            return workspaceJSON(try requireWorkspace(params))
        case "workspace.create":
            return try apiCreateWorkspace(params)
        case "workspace.update":
            return try apiUpdateWorkspace(params)
        case "workspace.move":
            return try apiMoveWorkspace(params)
        case "workspace.stop":
            return apiStopWorkspace(try requireWorkspace(params))
        case "workspace.restart":
            return apiRestartWorkspace(try requireWorkspace(params))
        case "workspace.delete":
            return try apiDeleteWorkspace(try requireWorkspace(params))
        case "tile.list":
            let workspaceID = params["workspaceId"] as? String
            let tiles = allSessionTiles.filter { workspaceID == nil || $0.session.workspaceID == workspaceID }
            return ["tiles": tiles.map(tileJSON)]
        case "tile.get":
            return tileJSON(try requireTile(params))
        case "tile.create":
            return try apiCreateTile(params)
        case "tile.update":
            return try apiUpdateTile(params)
        case "tile.move":
            return try apiMoveTile(params)
        case "tile.attach":
            return try apiAttachTile(try requireTile(params))
        case "tile.detach":
            return try apiDetachTile(try requireTile(params))
        case "tile.delete":
            return try apiDeleteTile(try requireTile(params))
        case "terminal.get":
            return terminalJSON(try requireTerminal(params))
        case "terminal.update":
            return try apiUpdateTerminal(params)
        case "terminal.send":
            return try apiSendTerminal(params)
        case "terminal.signal":
            return try apiSignalTerminal(params)
        case "terminal.stop":
            return apiStopTerminal(try requireTerminal(params))
        case "terminal.restart":
            return apiRestartTerminal(try requireTerminal(params), focus: params["focus"] as? Bool ?? false)
        case "status.list":
            refreshStatusBar()
            return [
                "widgets": statusWidgets.values.map { $0.json() },
                "effectiveWidgets": statusBarView.widgets.map { $0.json() },
            ]
        case "status.set":
            return try apiSetStatusWidget(params)
        case "status.remove":
            return try apiRemoveStatusWidget(params)
        case "ui.get":
            return uiJSON()
        case "ui.select":
            return try apiSelect(params)
        case "ui.focus":
            return try apiFocus(params)
        case "ui.enter":
            guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
            activate(selectedIndex)
            return uiJSON()
        case "ui.zoomOut":
            return try apiZoomOut(params)
        case "ui.overview":
            return try apiShowOverview()
        case "ui.activate":
            NSApp.activate(ignoringOtherApps: true)
            window?.makeKeyAndOrderFront(nil)
            return uiJSON()
        default:
            throw MachinenAPIError("unknown_operation", "Unknown operation: \(operation)")
        }
    }

    private func apiCreateWorkspace(_ params: JSONObject) throws -> Any {
        let name = try requiredString("name", in: params)
        guard !workspaces.contains(where: { $0.name == name }) else {
            throw MachinenAPIError("workspace_name_conflict", "A workspace named \(name) already exists")
        }
        let location: WorkspaceLocation
        if let requested = params["location"] as? JSONObject {
            location = try validatedWorkspaceLocation(locationFromJSON(requested))
        } else {
            location = .local(try validatedWorkingDirectory(
                params["workingDirectory"] as? String
                    ?? FileManager.default.homeDirectoryForCurrentUser.path
            ))
        }
        guard workspace(at: location) == nil else {
            throw MachinenAPIError(
                "workspace_location_conflict",
                "That location already belongs to another workspace"
            )
        }
        let workspace = WorkspaceRecord(
            name: name,
            workingDirectory: location.path,
            sshHost: location.sshHost
        )
        let position = clampedPosition(params["position"] as? Int, count: workspaces.count)
        workspaces.insert(workspace, at: position)
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.created", data: result)
        return result
    }

    private func updateWorkspaceLocation(
        _ workspace: WorkspaceRecord,
        to location: WorkspaceLocation
    ) throws {
        let validated = try validatedWorkspaceLocation(location)
        guard canonicalLocationKey(validated) != canonicalLocationKey(workspace.location) else { return }
        guard self.workspace(at: validated, excluding: workspace.id) == nil else {
            throw MachinenAPIError(
                "workspace_location_conflict",
                "That location already belongs to another workspace"
            )
        }
        guard !allSessionTiles.contains(where: { $0.session.workspaceID == workspace.id }) else {
            throw MachinenAPIError(
                "workspace_not_empty",
                "Remove this workspace's terminals before changing its location"
            )
        }
        workspace.location = validated
        for tile in allSessionTiles where tile.session.workspaceID == workspace.id {
            tile.session.location = validated
        }
    }

    private func apiUpdateWorkspace(_ params: JSONObject) throws -> Any {
        let workspace = try requireWorkspace(params)
        if let name = params["name"] as? String {
            guard !name.isEmpty else { throw MachinenAPIError("invalid_params", "name cannot be empty") }
            guard !workspaces.contains(where: { $0 !== workspace && $0.name == name }) else {
                throw MachinenAPIError("workspace_name_conflict", "A workspace named \(name) already exists")
            }
            workspace.name = name
            for tile in allSessionTiles where tile.session.workspaceID == workspace.id {
                tile.session.workspace = name
            }
        }
        if let requested = params["location"] as? JSONObject {
            try updateWorkspaceLocation(workspace, to: locationFromJSON(requested))
        } else if let directory = params["workingDirectory"] as? String {
            let location = workspace.location.sshHost.map {
                WorkspaceLocation.ssh(host: $0, path: directory)
            } ?? .local(directory)
            try updateWorkspaceLocation(workspace, to: location)
        }
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.updated", data: result)
        return result
    }

    private func apiMoveWorkspace(_ params: JSONObject) throws -> Any {
        let workspace = try requireWorkspace(params)
        guard let requested = params["position"] as? Int else {
            throw MachinenAPIError("invalid_params", "position is required")
        }
        guard let old = workspaces.firstIndex(where: { $0 === workspace }) else {
            throw MachinenAPIError("workspace_not_found", "Workspace does not exist")
        }
        workspaces.remove(at: old)
        workspaces.insert(workspace, at: clampedPosition(requested, count: workspaces.count))
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        setCameraImmediately()
        saveSessions()
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.moved", data: result)
        return result
    }

    private func apiStopWorkspace(_ workspace: WorkspaceRecord) -> Any {
        for tile in allSessionTiles where tile.session.workspaceID == workspace.id {
            tile.stopTerminal()
            tile.transition(to: .stopped, terminalText: tile.session.terminalText)
            emitAPIEvent("terminal.stateChanged", data: terminalJSON(tile))
        }
        saveSessions()
        return workspaceJSON(workspace)
    }

    private func apiRestartWorkspace(_ workspace: WorkspaceRecord) -> Any {
        for tile in allSessionTiles where tile.session.workspaceID == workspace.id {
            guard tile.currentState == .stopped || tile.currentState == .exited else { continue }
            tile.transition(to: .starting, terminalText: tile.session.terminalText)
            tile.restartTerminal()
        }
        saveSessions()
        return workspaceJSON(workspace)
    }

    private func apiDeleteWorkspace(_ workspace: WorkspaceRecord) throws -> Any {
        let tiles = allSessionTiles.filter { $0.session.workspaceID == workspace.id }
        guard !tiles.contains(where: { terminalIsRunning($0.session) }) else {
            throw MachinenAPIError("workspace_running", "Stop the workspace's terminals before deleting it")
        }
        let removalView: NSView? = if currentWorkspace == workspace.id {
            selectedSessionTile() ?? workspaceCluster(named: workspace.id)
        } else {
            workspaceCluster(named: workspace.id)
        }
        let removalSnapshot = removalView.flatMap(paneRemovalSnapshot)
        for tile in tiles {
            tile.removeTerminal()
            tile.removeFromSuperview()
            emitAPIEvent("tile.deleted", data: tileJSON(tile))
        }
        allSessionTiles.removeAll { $0.session.workspaceID == workspace.id }
        workspaces.removeAll { $0 === workspace }
        if currentWorkspace == workspace.id {
            currentWorkspace = nil
            focusedIndex = nil
        }
        rebuildWorkspaceClusters()
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot)
        saveSessions()
        let result = workspaceJSON(workspace)
        emitAPIEvent("workspace.deleted", data: result)
        return result
    }

    private func apiCreateTile(_ params: JSONObject) throws -> Any {
        let workspace = try requireWorkspace(params)
        let kind = params["kind"] as? String ?? "terminal"
        guard kind == "terminal" else {
            throw MachinenAPIError("invalid_params", "Only terminal tiles are supported in API v1")
        }
        let terminalParams = params["terminal"] as? JSONObject ?? [:]
        let location: WorkspaceLocation
        if let directory = terminalParams["workingDirectory"] as? String {
            location = try validatedWorkspaceLocation(
                workspace.location.sshHost.map {
                    WorkspaceLocation.ssh(host: $0, path: directory)
                } ?? .local(directory)
            )
        } else {
            location = workspace.location
        }
        let launch = try parseLaunch(terminalParams["launch"] as? JSONObject)
        let name = params["name"] as? String ?? defaultName(for: launch)
        let label = params["label"] as? String
            ?? nextAvailableLabel(workspace: workspace.name, session: name)
        guard !label.isEmpty else { throw MachinenAPIError("invalid_params", "label cannot be empty") }
        let session = TerminalSession(
            label: label,
            workspaceID: workspace.id,
            workspace: workspace.name,
            name: name,
            launch: launch,
            workingDirectory: location.path,
            sshHost: location.sshHost,
            state: .starting
        )
        let tile = TerminalTileView(session: session)
        installTile(tile)
        installPersistentTerminal(in: tile)
        let siblings = allSessionTiles.filter { $0.session.workspaceID == workspace.id }
        let position = clampedPosition(params["position"] as? Int, count: siblings.count)
        insertTile(tile, in: workspace.id, at: position)
        rebuildWorkspaceClusters()
        updateWorldGeometry()
        if params["focus"] as? Bool ?? false {
            currentWorkspace = workspace.id
            selectedIndex = position
            focusedIndex = position
            updateSelection()
            moveCamera()
        } else {
            updateSelection()
            setCameraImmediately()
        }
        saveSessions()
        let tileResult = tileJSON(tile)
        let terminalResult = terminalJSON(tile)
        emitAPIEvent("tile.created", data: tileResult)
        emitAPIEvent("terminal.stateChanged", data: terminalResult)
        return ["tile": tileResult, "terminal": terminalResult]
    }

    private func apiUpdateTile(_ params: JSONObject) throws -> Any {
        let tile = try requireTile(params)
        if let name = params["name"] as? String {
            guard !name.isEmpty else { throw MachinenAPIError("invalid_params", "name cannot be empty") }
            tile.session.name = name
        }
        if let label = params["label"] as? String {
            guard !label.isEmpty else { throw MachinenAPIError("invalid_params", "label cannot be empty") }
            guard !allSessionTiles.contains(where: { $0 !== tile && $0.session.label == label }) else {
                throw MachinenAPIError("conflict", "Another tile already uses label \(label)")
            }
            tile.session.label = label
        }
        if let activity = params["activityState"] as? String {
            guard let state = TerminalSession.ActivityState(rawValue: activity) else {
                throw MachinenAPIError("invalid_params", "Unknown activityState: \(activity)")
            }
            tile.session.activityState = state
        }
        tile.transition(to: tile.session.state, terminalText: tile.session.terminalText)
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.updated", data: result)
        return result
    }

    private func apiMoveTile(_ params: JSONObject) throws -> Any {
        let tile = try requireTile(params)
        let workspace = try requireWorkspace(params)
        guard tile.session.workspaceID == workspace.id else {
            throw MachinenAPIError(
                "terminal_relocation_unsupported",
                "Terminals cannot move between workspace locations"
            )
        }
        let movedTileWasSelected = currentWorkspace != nil && selectedSessionTile() === tile
        let movedTileWasFocused = movedTileWasSelected && focusedIndex != nil
        let position = clampedPosition(
            params["position"] as? Int,
            count: allSessionTiles.count { $0.session.workspaceID == workspace.id && $0 !== tile }
        )
        tile.session.workspaceID = workspace.id
        tile.session.workspace = workspace.name
        allSessionTiles.removeAll { $0 === tile }
        insertTile(tile, in: workspace.id, at: position)
        rebuildWorkspaceClusters()
        if movedTileWasSelected {
            currentWorkspace = workspace.id
            selectedIndex = position
            focusedIndex = movedTileWasFocused ? position : nil
        } else if currentWorkspace != nil {
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
        }
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.moved", data: result)
        return result
    }

    private func apiAttachTile(_ tile: TerminalTileView) throws -> Any {
        switch tile.currentState {
        case .running, .starting:
            return tileJSON(tile)
        case .detached, .disconnected:
            tile.transition(to: .starting, terminalText: tile.session.terminalText)
            tile.attachTerminal()
        case .stopped, .exited:
            throw MachinenAPIError("invalid_state", "Restart the terminal before attaching its viewer")
        }
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.viewerChanged", data: result)
        return result
    }

    private func apiDetachTile(_ tile: TerminalTileView) throws -> Any {
        guard terminalIsRunning(tile.session) else {
            throw MachinenAPIError("invalid_state", "A stopped terminal has no viewer to detach")
        }
        tile.transition(to: .detached, terminalText: tile.session.terminalText)
        tile.detachTerminalViewer()
        if focusedIndex != nil, selectedSessionTile() === tile {
            leaveFocusedSession()
        }
        saveSessions()
        let result = tileJSON(tile)
        emitAPIEvent("tile.viewerChanged", data: result)
        return result
    }

    private func apiDeleteTile(_ tile: TerminalTileView) throws -> Any {
        guard !terminalIsRunning(tile.session) else {
            throw MachinenAPIError("terminal_running", "Stop the terminal before deleting its tile")
        }
        let result = tileJSON(tile)
        let workspaceID = tile.session.workspaceID
        let removalSnapshot = paneRemovalSnapshot(of: tile)
        let previousFrames = allSessionTiles.compactMap { sibling in
            sibling !== tile && sibling.session.workspaceID == workspaceID
                ? (tile: sibling, frame: sibling.frame)
                : nil
        }
        tile.removeTerminal()
        tile.removeFromSuperview()
        allSessionTiles.removeAll { $0 === tile }
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            focusedIndex = nil
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
        }
        updateWorldGeometry()
        updateSelection()
        finishPaneRemoval(snapshot: removalSnapshot, previousFrames: previousFrames)
        saveSessions()
        emitAPIEvent("tile.deleted", data: result)
        return result
    }

    private func apiUpdateTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        guard let requested = params["title"] else {
            throw MachinenAPIError("invalid_params", "title is required")
        }
        if requested is NSNull {
            tile.session.titleOverride = nil
        } else if let title = requested as? String {
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= 128 else {
                throw MachinenAPIError("invalid_params", "title must contain 1 to 128 characters")
            }
            tile.session.titleOverride = trimmed
        } else {
            throw MachinenAPIError("invalid_params", "title must be a string or null")
        }
        tile.needsDisplay = true
        saveSessions()
        refreshStatusBar()
        let result = terminalJSON(tile)
        emitAPIEvent("terminal.updated", data: result)
        return result
    }

    private func apiSendTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        let hasText = params["text"] is String
        let hasData = params["dataBase64"] is String
        guard hasText != hasData else {
            throw MachinenAPIError("invalid_params", "Provide exactly one of text or dataBase64")
        }
        let data: Data
        if let text = params["text"] as? String {
            let value = text + ((params["appendNewline"] as? Bool ?? false) ? "\n" : "")
            data = Data(value.utf8)
        } else if let encoded = params["dataBase64"] as? String,
                  let decoded = Data(base64Encoded: encoded)
        {
            data = decoded
        } else {
            throw MachinenAPIError("invalid_params", "dataBase64 is invalid")
        }
        guard tile.sendTerminalInput(data) else {
            throw MachinenAPIError("terminal_input_failed", "Could not send input to the persistent PTY")
        }
        return ["terminalId": tile.session.id, "bytesWritten": data.count]
    }

    private func apiSignalTerminal(_ params: JSONObject) throws -> Any {
        let tile = try requireTerminal(params)
        let signal = try requiredString("signal", in: params)
        let mapped: String
        switch signal {
        case "interrupt": mapped = "interrupt"
        case "terminate": mapped = "TERM"
        case "kill": mapped = "KILL"
        case "hangup": mapped = "HUP"
        default: throw MachinenAPIError("invalid_params", "Unknown signal: \(signal)")
        }
        tile.signalTerminal(mapped)
        return terminalJSON(tile)
    }

    private func apiStopTerminal(_ tile: TerminalTileView) -> Any {
        tile.stopTerminal()
        tile.transition(to: .stopped, terminalText: tile.session.terminalText)
        saveSessions()
        let result = terminalJSON(tile)
        emitAPIEvent("terminal.stateChanged", data: result)
        return result
    }

    private func apiRestartTerminal(_ tile: TerminalTileView, focus: Bool) -> Any {
        tile.transition(to: .starting, terminalText: tile.session.terminalText)
        tile.restartTerminal()
        if focus {
            currentWorkspace = tile.session.workspaceID
            selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
            focusedIndex = selectedIndex
            updateSelection()
            moveCamera()
        }
        saveSessions()
        return terminalJSON(tile)
    }

    private func apiSetStatusWidget(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        guard id.count <= 128 else {
            throw MachinenAPIError("invalid_params", "status widget id must be at most 128 characters")
        }
        let (scopeKind, scopeID) = try parseStatusScope(params["scope"] as? JSONObject)
        let placementName = params["placement"] as? String ?? "right"
        let kindName = params["kind"] as? String ?? "text"
        let toneName = params["tone"] as? String ?? "neutral"
        let graphStyleName = params["graphStyle"] as? String
        guard let placement = MachinenStatusWidget.Placement(rawValue: placementName) else {
            throw MachinenAPIError("invalid_params", "Unknown status placement: \(placementName)")
        }
        guard let kind = MachinenStatusWidget.Kind(rawValue: kindName) else {
            throw MachinenAPIError("invalid_params", "Unknown status widget kind: \(kindName)")
        }
        guard let tone = MachinenStatusWidget.Tone(rawValue: toneName) else {
            throw MachinenAPIError("invalid_params", "Unknown status widget tone: \(toneName)")
        }
        let graphStyle = try graphStyleName.map { name in
            guard let style = MachinenStatusWidget.GraphStyle(rawValue: name) else {
                throw MachinenAPIError("invalid_params", "Unknown status graph style: \(name)")
            }
            return style
        }
        let value: String
        if let string = params["value"] as? String {
            value = string
        } else if let number = params["value"] as? NSNumber {
            value = number.stringValue
        } else if kind == .separator || kind == .state || kind == .progress || kind == .sparkline {
            value = ""
        } else {
            throw MachinenAPIError("invalid_params", "status widget value must be a string or number")
        }
        let samples = try statusSamples(params["samples"], name: "samples")
        let secondarySamples = try statusSamples(params["secondarySamples"], name: "secondarySamples")
        let links = try statusLinks(params["links"])
        let states = params["states"] as? [String] ?? []
        let validStates = Set(["working", "waiting", "idle", "unknown", "neutral", "good", "busy", "attention", "error"])
        guard states.count <= 32, states.allSatisfy(validStates.contains) else {
            throw MachinenAPIError("invalid_params", "status widget states contains an unsupported state")
        }
        let progress = (params["progress"] as? NSNumber)?.doubleValue
        if let progress, !(0...1).contains(progress) {
            throw MachinenAPIError("invalid_params", "status widget progress must be between 0 and 1")
        }
        let ttl = (params["ttlMilliseconds"] as? NSNumber)?.doubleValue
        if let ttl, ttl <= 0 {
            throw MachinenAPIError("invalid_params", "ttlMilliseconds must be positive")
        }
        let widget = MachinenStatusWidget(
            id: id,
            scopeKind: scopeKind,
            scopeID: scopeID,
            placement: placement,
            kind: kind,
            label: params["label"] as? String,
            value: value,
            progress: progress,
            tone: tone,
            tooltip: params["tooltip"] as? String,
            priority: (params["priority"] as? NSNumber)?.intValue ?? 50,
            expiresAt: ttl.map { Date().timeIntervalSince1970 + $0 / 1000 },
            graphStyle: graphStyle,
            samples: samples,
            secondarySamples: secondarySamples,
            states: states,
            links: links
        )
        statusWidgets[widget.storageKey] = widget
        refreshStatusBar()
        if let ttl, let expiresAt = widget.expiresAt {
            DispatchQueue.main.asyncAfter(deadline: .now() + ttl / 1000) { [weak self] in
                self?.expireStatusWidget(widget.storageKey, expiresAt: expiresAt)
            }
        }
        let result = widget.json()
        emitAPIEvent("status.changed", data: statusEventData(action: "set", widget: widget))
        return result
    }

    private func statusSamples(_ value: Any?, name: String) throws -> [Double] {
        guard let values = value as? [NSNumber] else { return [] }
        guard values.count <= 60 else {
            throw MachinenAPIError("invalid_params", "status widget \(name) must contain at most 60 values")
        }
        let samples = values.map(\.doubleValue)
        guard samples.allSatisfy({ $0.isFinite }) else {
            throw MachinenAPIError("invalid_params", "status widget \(name) values must be finite")
        }
        return samples
    }

    private func statusLinks(_ value: Any?) throws -> [MachinenStatusWidget.Link] {
        guard let values = value as? [JSONObject] else { return [] }
        guard values.count <= 32 else {
            throw MachinenAPIError("invalid_params", "status widget links must contain at most 32 values")
        }
        return try values.map { link in
            guard let title = link["title"] as? String, !title.isEmpty, title.count <= 512,
                  let rawURL = link["url"] as? String, rawURL.count <= 2_048,
                  let url = URL(string: rawURL), ["http", "https"].contains(url.scheme?.lowercased())
            else {
                throw MachinenAPIError("invalid_params", "status widget links require a title and HTTP(S) URL")
            }
            return MachinenStatusWidget.Link(title: title, url: url)
        }
    }

    private func expireStatusWidget(_ storageKey: String, expiresAt: TimeInterval) {
        guard let widget = statusWidgets[storageKey], widget.expiresAt == expiresAt,
              expiresAt <= Date().timeIntervalSince1970
        else { return }
        statusWidgets.removeValue(forKey: storageKey)
        refreshStatusBar()
        emitAPIEvent("status.changed", data: statusEventData(action: "expire", widget: widget))
    }

    private func apiRemoveStatusWidget(_ params: JSONObject) throws -> Any {
        let id = try requiredString("id", in: params)
        let (scopeKind, scopeID) = try parseStatusScope(params["scope"] as? JSONObject)
        let key = "\(scopeKind.rawValue):\(scopeID ?? ""):\(id)"
        guard let removed = statusWidgets.removeValue(forKey: key) else {
            throw MachinenAPIError("status_widget_not_found", "Status widget \(id) does not exist in that scope")
        }
        refreshStatusBar()
        let result = removed.json()
        emitAPIEvent("status.changed", data: statusEventData(action: "remove", widget: removed))
        return result
    }

    private func statusEventData(
        action: String,
        widget: MachinenStatusWidget
    ) -> JSONObject {
        var data: JSONObject = ["action": action, "widget": widget.json()]
        if widget.scopeKind == .machine, let machineID = widget.scopeID {
            data["machineId"] = machineID
        } else if widget.scopeKind == .workspace, let workspaceID = widget.scopeID {
            data["workspaceId"] = workspaceID
        } else if widget.scopeKind == .terminal, let terminalID = widget.scopeID {
            data["terminalId"] = terminalID
            if let tile = allSessionTiles.first(where: { $0.session.id == terminalID }) {
                data["workspaceId"] = tile.session.workspaceID
                data["tileId"] = tile.session.tileID
            }
        }
        return data
    }

    private func parseStatusScope(
        _ object: JSONObject?
    ) throws -> (MachinenStatusWidget.ScopeKind, String?) {
        let kindName = object?["kind"] as? String ?? "global"
        guard let kind = MachinenStatusWidget.ScopeKind(rawValue: kindName) else {
            throw MachinenAPIError("invalid_params", "Unknown status scope: \(kindName)")
        }
        if kind == .global { return (kind, nil) }
        guard let id = object?["id"] as? String, !id.isEmpty else {
            throw MachinenAPIError("invalid_params", "A \(kindName) status scope requires id")
        }
        if kind == .machine,
           !workspaces.contains(where: { $0.location.machineID == id })
        {
            throw MachinenAPIError("invalid_params", "Machine \(id) does not exist")
        }
        if kind == .workspace,
           !workspaces.contains(where: { $0.id == id })
        {
            throw MachinenAPIError("workspace_not_found", "Workspace \(id) does not exist")
        }
        if kind == .terminal,
           !allSessionTiles.contains(where: { $0.session.id == id })
        {
            throw MachinenAPIError("terminal_not_found", "Terminal \(id) does not exist")
        }
        return (kind, id)
    }

    private func apiSelect(_ params: JSONObject) throws -> Any {
        if let tileID = params["tileId"] as? String {
            guard let tile = allSessionTiles.first(where: { $0.session.tileID == tileID }) else {
                throw MachinenAPIError("tile_not_found", "Tile \(tileID) does not exist")
            }
            if currentWorkspace == tile.session.workspaceID {
                selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
            } else {
                currentWorkspace = nil
                selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == tile.session.workspaceID } ?? 0
            }
        } else if let workspaceID = params["workspaceId"] as? String {
            guard workspaceClusters.contains(where: { $0.workspaceID == workspaceID }) else {
                throw MachinenAPIError("workspace_not_found", "Workspace \(workspaceID) does not exist")
            }
            currentWorkspace = nil
            selectedIndex = workspaceClusters.firstIndex { $0.workspaceID == workspaceID } ?? 0
        } else {
            throw MachinenAPIError("invalid_params", "tileId or workspaceId is required")
        }
        focusedIndex = nil
        updateSelection()
        setCameraImmediately()
        return uiJSON()
    }

    private func apiFocus(_ params: JSONObject) throws -> Any {
        guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
        let tile = try requireTile(params)
        if tile.currentState == .detached {
            guard params["attach"] as? Bool ?? false else {
                throw MachinenAPIError("terminal_detached", "Attach the tile before focusing it")
            }
            _ = try apiAttachTile(tile)
        }
        currentWorkspace = tile.session.workspaceID
        selectedIndex = activeSessionTiles.firstIndex(where: { $0 === tile }) ?? 0
        focusedIndex = selectedIndex
        updateSelection()
        moveCamera()
        if params["activateApplication"] as? Bool ?? false {
            NSApp.activate(ignoringOtherApps: true)
            window?.makeKeyAndOrderFront(nil)
        }
        return uiJSON()
    }

    private func apiZoomOut(_ params: JSONObject) throws -> Any {
        guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
        let all = params["levels"] as? String == "all"
        let requested = params["levels"] as? Int ?? 1
        guard all || requested > 0 else { throw MachinenAPIError("invalid_params", "levels must be positive or all") }
        var remaining = all ? 2 : requested
        if focusedIndex != nil, remaining > 0 {
            focusedIndex = nil
            remaining -= 1
        }
        if currentWorkspace != nil, remaining > 0 {
            currentWorkspace = nil
            focusedIndex = nil
        }
        updateSelection()
        moveCamera()
        return uiJSON()
    }

    private func apiShowOverview() throws -> Any {
        guard !isTransitioning else { throw MachinenAPIError("conflict", "The camera is moving") }
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        updateSelection()
        moveCamera()
        return uiJSON()
    }

    private func locationFromJSON(_ value: JSONObject) throws -> WorkspaceLocation {
        let kind = try requiredString("kind", in: value)
        let path = try requiredString("path", in: value)
        switch kind {
        case WorkspaceLocation.Kind.local.rawValue:
            return .local(path)
        case WorkspaceLocation.Kind.ssh.rawValue:
            return .ssh(host: try requiredString("host", in: value), path: path)
        default:
            throw MachinenAPIError("invalid_params", "Unknown workspace location kind: \(kind)")
        }
    }

    private func validatedWorkspaceLocation(
        _ location: WorkspaceLocation
    ) throws -> WorkspaceLocation {
        switch location.kind {
        case .local:
            return .local(try validatedWorkingDirectory(location.path))
        case .ssh:
            guard let host = location.sshHost,
                  let parsed = WorkspaceLocation.parseSSHReference("\(host):\(location.path)")
            else {
                throw MachinenAPIError(
                    "invalid_params",
                    "Remote locations require an SSH host and an absolute path"
                )
            }
            return parsed
        }
    }

    private func validatedWorkingDirectory(_ path: String) throws -> String {
        let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: standardized, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            throw MachinenAPIError("invalid_params", "workingDirectory is not a directory")
        }
        return standardized
    }

    private func snapshotJSON() -> JSONObject {
        [
            "workspaces": workspaces.map(workspaceJSON),
            "tiles": allSessionTiles.map(tileJSON),
            "terminals": allSessionTiles.map(terminalJSON),
            "ui": uiJSON(),
        ]
    }

    private func workspaceJSON(_ workspace: WorkspaceRecord) -> JSONObject {
        [
            "id": workspace.id,
            "name": workspace.name,
            "workingDirectory": workspace.workingDirectory,
            "machineId": workspace.location.machineID,
            "location": workspace.location.json,
            "position": workspaces.firstIndex(where: { $0 === workspace }) ?? 0,
            "tileIds": allSessionTiles
                .filter { $0.session.workspaceID == workspace.id }
                .map { $0.session.tileID },
        ]
    }

    private func tileJSON(_ tile: TerminalTileView) -> JSONObject {
        let session = tile.session
        let siblings = allSessionTiles.filter { $0.session.workspaceID == session.workspaceID }
        return [
            "id": session.tileID,
            "workspaceId": session.workspaceID,
            "kind": "terminal",
            "name": session.name,
            "label": session.label,
            "pid": session.associatedPID ?? NSNull(),
            "shellPid": session.shellPID ?? NSNull(),
            "position": siblings.firstIndex(where: { $0 === tile }) ?? 0,
            "terminalId": session.id,
            "viewerState": session.state == .detached ? "detached" : "attached",
        ]
    }

    private func terminalJSON(_ tile: TerminalTileView) -> JSONObject {
        let session = tile.session
        return [
            "id": session.id,
            "tileId": session.tileID,
            "workingDirectory": session.workingDirectory,
            "location": session.location.json,
            "launch": launchJSON(session.launch),
            "backend": TerminalSession.backendName,
            "title": session.commandTitle,
            "runtimeLabel": session.runtimeLabel ?? NSNull(),
            "shellName": session.inferredShellName ?? NSNull(),
            "pid": session.associatedPID ?? NSNull(),
            "shellPid": session.shellPID ?? NSNull(),
            "titleOverride": session.titleOverride ?? NSNull(),
            "observedCommand": session.observedCommand ?? NSNull(),
            "processState": processState(session.state),
            "activityState": session.activityState.rawValue,
            "viewerState": session.state == .detached ? "detached" : "attached",
        ]
    }

    private func uiJSON() -> JSONObject {
        let selectedTile = selectedSessionTile()
        let level = focusedIndex != nil ? "terminal" : (currentWorkspace != nil ? "workspace" : "overview")
        return [
            "level": level,
            "selectedWorkspaceId": selectedWorkspaceID() ?? NSNull(),
            "selectedTileId": selectedTile?.session.tileID ?? NSNull(),
            "focusedTileId": focusedIndex == nil ? NSNull() : (selectedTile?.session.tileID ?? NSNull()),
            "statusTitle": statusBarView.title,
        ]
    }

    private func launchJSON(_ launch: TerminalLaunch) -> JSONObject {
        var result: JSONObject = ["kind": launch.kind.rawValue]
        if let command = launch.command { result["command"] = command }
        if let executable = launch.executable { result["executable"] = executable }
        if let arguments = launch.arguments { result["arguments"] = arguments }
        if let environment = launch.environment { result["environment"] = environment }
        return result
    }

    private func parseLaunch(_ value: JSONObject?) throws -> TerminalLaunch {
        guard let value else { return .loginShell }
        let kind = value["kind"] as? String ?? "loginShell"
        switch kind {
        case "loginShell":
            return .loginShell
        case "shellCommand":
            return .shellCommand(try requiredString("command", in: value))
        case "exec":
            let executable = try requiredString("executable", in: value)
            let arguments = value["arguments"] as? [String] ?? []
            let environment = value["environment"] as? [String: String]
            return .executable(executable, arguments: arguments, environment: environment)
        default:
            throw MachinenAPIError("invalid_params", "Unknown launch kind: \(kind)")
        }
    }

    private func defaultName(for launch: TerminalLaunch) -> String {
        switch launch.kind {
        case .loginShell: return "shell"
        case .shellCommand:
            return launch.command?.split(separator: " ").first.map(String.init) ?? "command"
        case .exec:
            return launch.executable.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "command"
        }
    }

    private func launchDescription(_ launch: TerminalLaunch) -> String {
        switch launch.kind {
        case .loginShell: return "$SHELL -l"
        case .shellCommand: return launch.command ?? "$SHELL -lc"
        case .exec:
            return ([launch.executable ?? ""] + (launch.arguments ?? [])).joined(separator: " ")
        }
    }

    private func processState(_ state: TerminalSession.State) -> String {
        switch state {
        case .starting: return "starting"
        case .running, .detached: return "running"
        case .stopped: return "stopped"
        case .exited: return "exited"
        case .disconnected: return "disconnected"
        }
    }

    private func terminalIsRunning(_ session: TerminalSession) -> Bool {
        session.state == .starting || session.state == .running || session.state == .detached
            || session.state == .disconnected
    }

    private func requireWorkspace(_ params: JSONObject) throws -> WorkspaceRecord {
        let id = try requiredString("workspaceId", in: params)
        guard let workspace = workspaces.first(where: { $0.id == id }) else {
            throw MachinenAPIError("workspace_not_found", "Workspace \(id) does not exist")
        }
        return workspace
    }

    private func requireTile(_ params: JSONObject) throws -> TerminalTileView {
        let id = try requiredString("tileId", in: params)
        guard let tile = allSessionTiles.first(where: { $0.session.tileID == id }) else {
            throw MachinenAPIError("tile_not_found", "Tile \(id) does not exist")
        }
        return tile
    }

    private func requireTerminal(_ params: JSONObject) throws -> TerminalTileView {
        let id = try requiredString("terminalId", in: params)
        guard let tile = allSessionTiles.first(where: { $0.session.id == id }) else {
            throw MachinenAPIError("terminal_not_found", "Terminal \(id) does not exist")
        }
        return tile
    }

    private func requiredString(_ key: String, in params: JSONObject) throws -> String {
        guard let value = params[key] as? String, !value.isEmpty else {
            throw MachinenAPIError("invalid_params", "\(key) is required")
        }
        return value
    }

    private func clampedPosition(_ requested: Int?, count: Int) -> Int {
        min(max(0, requested ?? count), count)
    }

    private func insertTile(_ tile: TerminalTileView, in workspaceID: String, at position: Int) {
        let indexes = allSessionTiles.indices.filter {
            allSessionTiles[$0].session.workspaceID == workspaceID
        }
        if indexes.indices.contains(position) {
            allSessionTiles.insert(tile, at: indexes[position])
        } else if let last = indexes.last {
            allSessionTiles.insert(tile, at: last + 1)
        } else if let workspacePosition = workspaces.firstIndex(where: { $0.id == workspaceID }) {
            let laterIDs = Set(workspaces.dropFirst(workspacePosition + 1).map(\.id))
            let insertion = allSessionTiles.firstIndex { laterIDs.contains($0.session.workspaceID) }
                ?? allSessionTiles.endIndex
            allSessionTiles.insert(tile, at: insertion)
        } else {
            allSessionTiles.append(tile)
        }
    }

    private func emitAPIEvent(_ event: String, data: JSONObject) {
        onAPIEvent?(event, data)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
        bounds.fill()
        if focusedIndex == nil, currentWorkspace == nil {
            drawKeyHints()
        }
    }

    private func refreshStatusBar() {
        let now = Date().timeIntervalSince1970
        statusWidgets = statusWidgets.filter { $0.value.expiresAt.map { $0 > now } ?? true }

        let workspaceID = selectedWorkspaceID()
        let focusedTerminalID = focusedIndex == nil ? nil : selectedSession()?.id
        let workspace = selectedWorkspaceRecord()
        if let terminal = focusedTerminalID.flatMap({ id in allSessionTiles.first { $0.session.id == id } }) {
            let workspaceName = workspace?.name ?? terminal.session.workspace
            statusBarView.title = "\(workspaceName) > \(terminal.session.displayName)"
            statusBarView.titleTooltip = workspace.map {
                "\($0.location.displayName) · \(terminal.session.commandTitle)"
            }
        } else if let workspace {
            statusBarView.title = workspace.name
            statusBarView.titleTooltip = workspace.location.displayName
        } else {
            statusBarView.title = "MACHINEN"
            statusBarView.titleTooltip = nil
        }

        var resolved: [String: MachinenStatusWidget] = [:]
        let orderedScopes: [(MachinenStatusWidget.ScopeKind, String?)] = [
            (.global, nil),
            (.machine, workspace?.location.machineID),
            (.workspace, workspaceID),
            (.terminal, focusedTerminalID),
        ]
        for (kind, scopeID) in orderedScopes {
            guard kind == .global || scopeID != nil else { continue }
            for widget in statusWidgets.values
                where widget.scopeKind == kind && widget.scopeID == scopeID
            {
                resolved[widget.id] = widget
            }
        }
        statusBarView.widgets = Array(resolved.values)
    }

    private func drawKeyHints() {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.43, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        let text: String
        if !labelBuffer.isEmpty {
            text = "TYPE LABEL  \(labelBuffer)_"
        } else if currentWorkspace == nil {
            text = "arrows  select     return / ⌘↓  zoom in     hold space  peek"
        } else if focusedIndex != nil {
            text = "⌘← / ⌘→  terminal     ⌘[ / ⌘]  workspace     ⌘K  commands     ⌘↑  zoom out"
        } else {
            text = "⌘↑  zoom out     arrows  select     return / ⌘↓  zoom in     ⌘T  new terminal"
        }
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(
                x: Metrics.sideInset,
                y: bounds.height - 31,
                width: bounds.width - Metrics.sideInset * 2,
                height: 16
            )
        )
    }
}

private final class CameraSceneView: NSView {
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
}
