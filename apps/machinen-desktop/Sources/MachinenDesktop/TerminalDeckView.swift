import AppKit

final class TerminalDeckView: NSView {
    private struct CameraAnimation {
        let start: NSRect
        let target: NSRect
        let startedAt: TimeInterval
        let duration: TimeInterval
        let completion: (@MainActor () -> Void)?
    }

    private enum PaletteKind {
        case commands
        case newTerminal
        case runCommand
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
    private var presentedOverlay: NSView?
    private var lastFocusedEscapeAt: TimeInterval?
    private var lastViewportSize = NSSize.zero
    private var cameraAnimation: CameraAnimation?
    private var cameraAnimationTimer: Timer?

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    var onAPIEvent: ((String, [String: Any]) -> Void)?

    init(state: MachinenStoredState, sessionStore: TerminalSessionStore) {
        self.sessionStore = sessionStore
        workspaces = state.workspaces
        allSessionTiles = state.sessions.map { TerminalTileView(session: $0) }
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor
        layer?.masksToBounds = true

        addSubview(sceneView)
        for tile in allSessionTiles {
            installTile(tile)
            installPersistentTerminal(in: tile)
        }
        rebuildWorkspaceClusters()
        enterSoleTerminalIfNeeded()
        updateSelection()
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private var activeSessionTiles: [TerminalTileView] {
        guard let currentWorkspace else { return [] }
        return allSessionTiles.filter { $0.session.workspaceID == currentWorkspace }
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

    private func selectedWorkspace() -> String? {
        guard let workspaceID = selectedWorkspaceID() else { return nil }
        return workspaces.first { $0.id == workspaceID }?.name
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
        tile.onSelect = { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.window?.makeFirstResponder(self)
            if self.currentWorkspace == nil {
                guard let index = self.workspaceClusters.firstIndex(where: {
                    $0.workspaceID == tile.session.workspaceID
                }) else { return }
                self.select(index)
            } else {
                guard let index = self.activeSessionTiles.firstIndex(where: { $0 === tile }) else {
                    return
                }
                self.select(index)
            }
        }
        tile.onActivate = { [weak self, weak tile] in
            guard let self, let tile else { return }
            if self.currentWorkspace == nil {
                guard let index = self.workspaceClusters.firstIndex(where: {
                    $0.workspaceID == tile.session.workspaceID
                }) else { return }
                self.activate(index)
            } else if let index = self.activeSessionTiles.firstIndex(where: { $0 === tile }) {
                self.activate(index)
            }
        }
        tile.onDragBegan = nil
        tile.onDragChanged = nil
        tile.onDragEnded = nil
    }

    private func installPersistentTerminal(in tile: TerminalTileView) {
        let terminalView = MachinenTerminalView(session: tile.session)
        terminalView.onDoubleEscape = { [weak self] in
            self?.leaveFocusedSession()
        }
        terminalView.onStateChange = { [weak self, weak tile] state in
            guard let self, let tile, !self.isShuttingDown else { return }
            tile.transition(to: state, terminalText: tile.session.terminalText)
            self.saveSessions()
            self.emitAPIEvent("terminal.stateChanged", data: self.terminalJSON(tile))
        }
        terminalView.onOutput = { [weak self, weak tile] data in
            guard let self, let tile else { return }
            self.emitAPIEvent("terminal.output", data: [
                "terminalId": tile.session.id,
                "tileId": tile.session.tileID,
                "workspaceId": tile.session.workspaceID,
                "dataBase64": data.base64EncodedString(),
            ])
        }
        tile.installTerminalView(terminalView)
    }

    private func saveSessions() {
        sessionStore.save(MachinenStoredState(
            workspaces: workspaces,
            sessions: allSessionTiles.map(\.session)
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
                        self.select(index)
                    }
                }
                cluster.onActivate = { [weak self, weak cluster] in
                    guard let self, let cluster,
                          let index = self.workspaceClusters.firstIndex(where: { $0 === cluster }),
                          self.currentWorkspace == nil
                    else { return }
                    self.activate(index)
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
        duration: TimeInterval = 0.38,
        completion: (@MainActor () -> Void)? = nil
    ) {
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
        let progress = CGFloat(linearProgress * linearProgress * (3 - 2 * linearProgress))

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

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        if focusedIndex != nil {
            if modifiers.isEmpty, event.keyCode == 53 {
                handleFocusedEscape()
            } else {
                lastFocusedEscapeAt = nil
            }
            return
        }
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

    private func handleFocusedEscape() {
        let now = ProcessInfo.processInfo.systemUptime
        if let previous = lastFocusedEscapeAt, now - previous <= 0.45 {
            lastFocusedEscapeAt = nil
            leaveFocusedSession()
        } else {
            // A real terminal receives this first Escape immediately.
            lastFocusedEscapeAt = now
        }
    }

    private func select(_ index: Int) {
        guard (0..<activeCount).contains(index) else { return }
        selectedIndex = index
        updateSelection()
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
        moveCamera(to: cameraBounds(for: target, viewport: bounds), duration: 0.16)
    }

    private func endPeek() {
        guard isPeeking, let cameraBounds = peekCameraBounds else { return }
        isPeeking = false
        peekCameraBounds = nil
        moveCamera(to: cameraBounds, duration: 0.16)
    }

    private func activate(_ index: Int) {
        guard (0..<activeCount).contains(index), focusedIndex == nil,
              commandPalette == nil, !isTransitioning
        else { return }
        select(index)
        clearLabelBuffer()
        lastFocusedEscapeAt = nil

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
        lastFocusedEscapeAt = nil
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
        guard !isTransitioning, !isPeeking, let session = selectedSession(),
              let workspace = selectedWorkspace()
        else { return }

        let context: String
        if currentWorkspace == nil,
           let cluster = workspaceCluster(named: selectedWorkspaceID())
        {
            context = "\(workspace) · \(cluster.sessions.count) \(cluster.sessions.count == 1 ? "terminal" : "terminals")"
        } else {
            context = "\(workspace) / \(session.name)"
        }
        let palette = CommandPaletteView(
            frame: bounds,
            context: context,
            commands: paletteCommands(for: session)
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

    func toggleNewTerminalPalette() {
        guard presentedOverlay == nil else { return }
        if commandPalette != nil {
            let wasNewTerminal = paletteKind == .newTerminal
            dismissCommandPalette()
            if wasNewTerminal { return }
        }
        guard !isTransitioning, !isPeeking else { return }
        let workspace = selectedWorkspace() ?? "workspace"
        let workingDirectory = selectedSessionTile()?.session.workingDirectory
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
            return
        }
        window?.makeFirstResponder(self)
    }

    private func paletteCommands(for session: TerminalSession) -> [PaletteCommand] {
        if currentWorkspace == nil {
            return [
                PaletteCommand(id: .toggleOverview, title: "View: Open \(session.workspace)", shortcut: "return"),
                PaletteCommand(id: .newTerminal, title: "Terminal: New in \(session.workspace)…", shortcut: "⌘T"),
                PaletteCommand(id: .showDiagnostics, title: "Workspace: Show diagnostics…", shortcut: ""),
                PaletteCommand(id: .stopWorkspace, title: "Workspace: Stop \(session.workspace)…", shortcut: ""),
                PaletteCommand(id: .deleteWorkspace, title: "Workspace: Delete \(session.workspace)…", shortcut: ""),
            ]
        }

        let viewCommand: String
        if focusedIndex == nil {
            viewCommand = "View: Focus selected session"
        } else if activeSessionTiles.count == 1 {
            viewCommand = "View: Show all workspaces"
        } else {
            viewCommand = "View: Show session overview"
        }
        var commands = [
            PaletteCommand(id: .toggleOverview, title: viewCommand, shortcut: "left⌘ + right⌘"),
            PaletteCommand(id: .newTerminal, title: "Terminal: New in \(session.workspace)…", shortcut: "⌘T"),
        ]
        switch selectedSessionTile()?.currentState {
        case .detached:
            commands.append(PaletteCommand(id: .attachSession, title: "Session: Attach viewer", shortcut: ""))
        case .disconnected:
            commands.append(PaletteCommand(id: .reconnectSession, title: "Session: Reconnect", shortcut: ""))
        case .stopped:
            commands.append(PaletteCommand(id: .restartSession, title: "Session: Restart \(session.name)", shortcut: ""))
        default:
            commands.append(PaletteCommand(id: .detachSession, title: "Session: Detach viewer", shortcut: "⌘W"))
            commands.append(PaletteCommand(id: .stopSession, title: "Session: Stop \(session.name)…", shortcut: ""))
        }
        commands.append(contentsOf: [
            PaletteCommand(id: .showDiagnostics, title: "Session: Show diagnostics…", shortcut: ""),
            PaletteCommand(id: .stopWorkspace, title: "Workspace: Stop \(session.workspace)…", shortcut: ""),
            PaletteCommand(id: .deleteWorkspace, title: "Workspace: Delete \(session.workspace)…", shortcut: ""),
        ])
        return commands
    }

    private func runPaletteCommand(_ command: PaletteCommand, from palette: CommandPaletteView?) {
        switch command.id {
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
        case .deleteWorkspace:
            dismissCommandPalette()
            confirmDeleteSelectedWorkspace()
        case .showDiagnostics:
            dismissCommandPalette()
            showDiagnostics()
        default:
            palette?.showStatus("Prototype only · \(command.title)")
        }
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

    private func confirmDeleteSelectedWorkspace() {
        guard let workspace = selectedWorkspace() else { return }
        presentConfirmation(
            heading: "Delete workspace \(workspace)?",
            message: "This stops its terminal processes and removes their saved definitions from Machinen.",
            consequence: "Files in the terminals' working directories are not deleted.",
            confirmTitle: "Delete workspace"
        ) { [weak self] in
            self?.deleteWorkspace(workspace)
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

    private func deleteWorkspace(_ workspace: String) {
        let workspaceRecord = workspaces.first { $0.name == workspace }
        let removedTiles = allSessionTiles.filter { $0.session.workspace == workspace }
        for tile in removedTiles {
            tile.stopTerminal()
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
        setCameraImmediately()
        saveSessions()
        if let workspaceRecord {
            emitAPIEvent("workspace.deleted", data: [
                "id": workspaceRecord.id,
                "name": workspaceRecord.name,
            ])
        }
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
            sessions        \(sessions.count)
            state file      \(sessionStore.manifestURL.path)

            SESSION STATE
            \(sessionLines)

            PERSISTENCE
            Terminal commands are owned by the bundled dtach helper and survive
            viewer or application exit. Machinen restores and reattaches each
            running viewer from the state file above.
            """
        } else if let tile = selectedSessionTile() {
            heading = "SESSION DIAGNOSTICS · \(workspace) / \(tile.session.name)"
            text = """
            workspace       \(workspace)
            session         \(tile.session.name)
            session id      \(tile.session.id)
            state            \(tile.currentState.rawValue)
            viewer           \(tile.currentState == .detached ? "detached" : "attached")
            command          \(launchDescription(tile.session.launch))
            working dir      \(tile.session.workingDirectory)
            dtach socket     \(tile.session.socketPath)
            state file       \(sessionStore.manifestURL.path)

            PERSISTENCE
            The bundled machinen-dtach helper owns this command. Its viewer
            uses -E, so dtach does not reserve or interpret any input bytes.
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
        for tile in allSessionTiles where tile.session.state == .running || tile.session.state == .starting {
            tile.detachTerminalForApplicationExit()
            tile.session.state = .running
        }
        saveSessions()
    }

    func handleCommandW() {
        if presentedOverlay != nil {
            dismissPresentedOverlay()
            return
        }
        if commandPalette != nil {
            dismissCommandPalette()
            return
        }
        if focusedIndex != nil {
            detachSelectedSession()
        }
    }

    private func createPersistentSession(
        workspace: String,
        name: String,
        command: String?,
        workingDirectory: String
    ) {
        let workspaceRecord: WorkspaceRecord
        if let existing = workspaces.first(where: { $0.name == workspace }) {
            workspaceRecord = existing
        } else {
            workspaceRecord = WorkspaceRecord(name: workspace)
            workspaces.append(workspaceRecord)
        }
        let session = TerminalSession(
            label: nextAvailableLabel(workspace: workspace, session: name),
            workspaceID: workspaceRecord.id,
            workspace: workspace,
            name: name,
            launch: command.map(TerminalLaunch.shellCommand) ?? .loginShell,
            workingDirectory: workingDirectory,
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
        case "terminal.send":
            return try apiSendTerminal(params)
        case "terminal.signal":
            return try apiSignalTerminal(params)
        case "terminal.stop":
            return apiStopTerminal(try requireTerminal(params))
        case "terminal.restart":
            return apiRestartTerminal(try requireTerminal(params), focus: params["focus"] as? Bool ?? false)
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
        let workspace = WorkspaceRecord(name: name)
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
        for tile in tiles {
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
        setCameraImmediately()
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
        let workingDirectory = terminalParams["workingDirectory"] as? String
            ?? FileManager.default.homeDirectoryForCurrentUser.path
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: workingDirectory, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            throw MachinenAPIError("invalid_params", "workingDirectory is not a directory")
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
            workingDirectory: workingDirectory,
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
        tile.removeFromSuperview()
        allSessionTiles.removeAll { $0 === tile }
        rebuildWorkspaceClusters()
        if currentWorkspace == workspaceID {
            focusedIndex = nil
            selectedIndex = min(selectedIndex, max(0, activeSessionTiles.count - 1))
        }
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
        saveSessions()
        emitAPIEvent("tile.deleted", data: result)
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
            "launch": launchJSON(session.launch),
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
            drawMetadata()
            drawKeyHints()
        }
    }

    private func drawMetadata() {
        let title: String
        if let currentWorkspace {
            let workspaceName = workspaces.first { $0.id == currentWorkspace }?.name ?? "workspace"
            title = "MACHINEN / \(workspaceName) · \(activeSessionTiles.count) LIVE SESSIONS"
        } else {
            title = "MACHINEN · \(workspaceClusters.count) WORKSPACES"
        }
        drawLabel(title, x: Metrics.windowControlsInset, alignment: .left)
        if bounds.width >= 820 {
            drawLabel(
                "⌘K  commands     ⌘T  new terminal",
                x: bounds.width - Metrics.sideInset,
                alignment: .right
            )
        }
    }

    private func drawLabel(_ text: String, x: CGFloat, alignment: NSTextAlignment) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        let width = min(420, max(0, bounds.width - Metrics.sideInset * 2))
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.56, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: alignment == .left ? x : x - width, y: 20, width: width, height: 18)
        )
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
            text = "arrows  select     return  zoom in     hold space  peek"
        } else {
            text = "esc  zoom out     arrows  select     return  zoom in     ⌘T  new terminal"
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
