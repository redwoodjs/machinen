import AppKit

final class TerminalDeckView: NSView {
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
    private var allSessionTiles: [TerminalTileView]
    private var workspaceClusters: [WorkspaceClusterView] = []
    private var workspaceUnion = NSRect.zero
    private var currentWorkspace: String?
    private var selectedIndex = 0
    private var focusedIndex: Int?
    private var isTransitioning = false
    private var isPeeking = false
    private var peekCameraFrame: NSRect?
    private var labelBuffer = ""
    private var simulationTick = 38
    private var simulatedOutputTimer: Timer?
    private var commandPalette: CommandPaletteView?
    private var paletteKind: PaletteKind?
    private var presentedOverlay: NSView?
    private var lastFocusedEscapeAt: TimeInterval?
    private var lastViewportSize = NSSize.zero

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(sessions: [MockSession]) {
        allSessionTiles = sessions.map { TerminalTileView(session: $0) }
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor
        layer?.masksToBounds = true

        addSubview(sceneView)
        for tile in allSessionTiles {
            installTile(tile)
        }
        rebuildWorkspaceClusters()
        updateSelection()

        simulatedOutputTimer = Timer.scheduledTimer(
            timeInterval: 1.2,
            target: self,
            selector: #selector(advanceSimulatedOutput),
            userInfo: nil,
            repeats: true
        )
        setAccessibilityElement(false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private var activeSessionTiles: [TerminalTileView] {
        guard let currentWorkspace else { return [] }
        return allSessionTiles.filter { $0.session.workspace == currentWorkspace }
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

    private func workspaceCluster(named workspace: String?) -> WorkspaceClusterView? {
        guard let workspace else { return nil }
        return workspaceClusters.first { $0.workspace == workspace }
    }

    private func selectedWorkspace() -> String? {
        if let currentWorkspace {
            return currentWorkspace
        }
        guard workspaceClusters.indices.contains(selectedIndex) else { return nil }
        return workspaceClusters[selectedIndex].workspace
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

    private func selectedSession() -> MockSession? {
        selectedSessionTile()?.session
    }

    private func installTile(_ tile: TerminalTileView) {
        tile.onSelect = { [weak self, weak tile] in
            guard let self, let tile else { return }
            self.window?.makeFirstResponder(self)
            if self.currentWorkspace == nil {
                guard let index = self.workspaceClusters.firstIndex(where: {
                    $0.workspace == tile.session.workspace
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
                    $0.workspace == tile.session.workspace
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

    private func rebuildWorkspaceClusters() {
        let existing = Dictionary(uniqueKeysWithValues: workspaceClusters.map { ($0.workspace, $0) })
        var names: [String] = []
        for tile in allSessionTiles where !names.contains(tile.session.workspace) {
            names.append(tile.session.workspace)
        }

        var usedLabels = Set(existing.values.map(\.label))
        workspaceClusters = names.map { workspace in
            let cluster: WorkspaceClusterView
            if let current = existing[workspace] {
                cluster = current
            } else {
                let base = String(workspace.lowercased().prefix(2)).padding(
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
                cluster = WorkspaceClusterView(workspace: workspace, label: label)
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

        for (workspace, cluster) in existing where !names.contains(workspace) {
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
                sessions: allSessionTiles.filter { $0.session.workspace == cluster.workspace },
                terminalSize: terminalSize
            )
        }
        guard !workspaceClusters.isEmpty else {
            workspaceUnion = .zero
            sceneView.setWorldSize(NSSize(width: bounds.width, height: bounds.height))
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

        let worldWidth = (xOffsets.last ?? 0) + (columnWidths.last ?? 0) + Metrics.worldMargin
        let worldHeight = (yOffsets.last ?? 0) + (rowHeights.last ?? 0) + Metrics.worldMargin
        sceneView.setWorldSize(NSSize(width: worldWidth, height: worldHeight))
    }

    private func cameraFrame(for target: NSRect, viewport: NSRect) -> NSRect {
        guard target.width > 0, target.height > 0,
              sceneView.bounds.width > 0, sceneView.bounds.height > 0
        else { return bounds }
        let scale = min(viewport.width / target.width, viewport.height / target.height)
        return NSRect(
            x: viewport.midX - target.midX * scale,
            y: viewport.midY - target.midY * scale,
            width: sceneView.bounds.width * scale,
            height: sceneView.bounds.height * scale
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

    private func currentCameraFrame() -> NSRect {
        if let focusedIndex {
            let sessions = activeSessionTiles
            if sessions.indices.contains(focusedIndex),
               let cluster = workspaceCluster(named: currentWorkspace),
               let terminalFrame = cluster.frameForSession(sessions[focusedIndex], in: sceneView)
            {
                return cameraFrame(for: terminalFrame, viewport: bounds)
            }
        }
        if let cluster = workspaceCluster(named: currentWorkspace) {
            return cameraFrame(for: cluster.frame, viewport: bounds)
        }
        return cameraFrame(
            for: workspaceUnion.insetBy(dx: -Metrics.worldMargin / 2, dy: -Metrics.worldMargin / 2),
            viewport: overviewViewport()
        )
    }

    private func setCameraImmediately() {
        sceneView.frame = currentCameraFrame().integral
        sceneView.restoreWorldBounds()
        needsDisplay = true
    }

    private func moveCamera(
        to destination: NSRect? = nil,
        duration: TimeInterval = 0.34,
        completion: (@MainActor () -> Void)? = nil
    ) {
        isTransitioning = true
        needsDisplay = true
        let target = (destination ?? currentCameraFrame()).integral
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            sceneView.animator().frame = target
        } completionHandler: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.sceneView.restoreWorldBounds()
                self.isTransitioning = false
                self.window?.makeFirstResponder(self)
                self.needsDisplay = true
                completion?()
            }
        }
    }

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        if focusedIndex != nil {
            if modifiers.isEmpty, event.keyCode == 53 {
                handleFocusedEscape()
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
            cluster.isEntered = cluster.workspace == currentWorkspace
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
        }
        needsDisplay = true
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
        } else {
            let workspaceIndexes = allSessionTiles.indices.filter {
                allSessionTiles[$0].session.workspace == currentWorkspace
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
        peekCameraFrame = sceneView.frame
        moveCamera(to: cameraFrame(for: target, viewport: bounds), duration: 0.16)
    }

    private func endPeek() {
        guard isPeeking, let frame = peekCameraFrame else { return }
        isPeeking = false
        peekCameraFrame = nil
        moveCamera(to: frame, duration: 0.16)
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
            currentWorkspace = cluster.workspace
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
        selectedIndex = workspaceClusters.firstIndex { $0.workspace == workspace } ?? 0
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
            selectedIndex = workspaceClusters.firstIndex { $0.workspace == workspace } ?? 0
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
           let cluster = workspaceCluster(named: workspace)
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
        guard !isTransitioning, !isPeeking, let workspace = selectedWorkspace() else { return }
        showNewTerminalPalette(workspace: workspace)
    }

    private func showNewTerminalPalette(workspace: String) {
        let palette = CommandPaletteView(
            frame: bounds,
            heading: "NEW TERMINAL",
            context: "workspace: \(workspace)",
            placeholder: "What should this terminal run?",
            defaultFooter: "New sessions use the selected workspace by default",
            commands: [
                PaletteCommand(id: .createShell, title: "Shell", shortcut: "/bin/bash"),
                PaletteCommand(id: .createClaude, title: "Claude Code", shortcut: "claude"),
                PaletteCommand(id: .createCodex, title: "Codex", shortcut: "codex"),
                PaletteCommand(id: .createPi, title: "Pi", shortcut: "pi"),
                PaletteCommand(id: .runCommand, title: "Run command…", shortcut: ">"),
                PaletteCommand(id: .chooseProject, title: "Workspace: Choose another project…", shortcut: "⇧⌘O"),
            ]
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in self?.dismissCommandPalette() }
        palette.onRun = { [weak self, weak palette] command in
            self?.runNewTerminalCommand(command, workspace: workspace, from: palette)
        }
        commandPalette = palette
        paletteKind = .newTerminal
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func runNewTerminalCommand(
        _ command: PaletteCommand,
        workspace: String,
        from palette: CommandPaletteView?
    ) {
        switch command.id {
        case .createShell:
            dismissCommandPalette()
            createSimulatedSession(workspace: workspace, name: "shell", command: "/bin/bash")
        case .createClaude:
            dismissCommandPalette()
            createSimulatedSession(workspace: workspace, name: "claude", command: "claude")
        case .createCodex:
            dismissCommandPalette()
            createSimulatedSession(workspace: workspace, name: "codex", command: "codex")
        case .createPi:
            dismissCommandPalette()
            createSimulatedSession(workspace: workspace, name: "pi", command: "pi")
        case .runCommand:
            showRunCommandPalette(workspace: workspace)
        case .chooseProject:
            chooseAnotherProject()
        default:
            palette?.showStatus("That command is not available in this palette")
        }
    }

    private func showRunCommandPalette(workspace: String) {
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
            self.createSimulatedSession(workspace: workspace, name: executable, command: command)
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
                self?.showNewTerminalPalette(workspace: workspace)
            }
        }
    }

    private func dismissCommandPalette() {
        commandPalette?.removeFromSuperview()
        commandPalette = nil
        paletteKind = nil
        window?.makeFirstResponder(self)
    }

    private func paletteCommands(for session: MockSession) -> [PaletteCommand] {
        if currentWorkspace == nil {
            return [
                PaletteCommand(id: .toggleOverview, title: "View: Open \(session.workspace)", shortcut: "return"),
                PaletteCommand(id: .newTerminal, title: "Session: New terminal in \(session.workspace)…", shortcut: "⌘T"),
                PaletteCommand(id: .openPreview, title: "Workspace: Open preview", shortcut: ""),
                PaletteCommand(id: .reviewChanges, title: "Workspace: Review changes", shortcut: ""),
                PaletteCommand(id: .showDiagnostics, title: "Workspace: Show diagnostics…", shortcut: ""),
                PaletteCommand(id: .stopWorkspace, title: "Workspace: Stop \(session.workspace)…", shortcut: ""),
                PaletteCommand(id: .deleteWorkspace, title: "Workspace: Delete \(session.workspace)…", shortcut: ""),
                PaletteCommand(id: .simulateRelaunch, title: "Application: Simulate relaunch", shortcut: ""),
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
            PaletteCommand(id: .newTerminal, title: "Session: New terminal in \(session.workspace)…", shortcut: "⌘T"),
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
            PaletteCommand(id: .simulateRelaunch, title: "Application: Simulate relaunch", shortcut: ""),
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
        case .showDiagnostics, .inspectWorkspace:
            dismissCommandPalette()
            showDiagnostics()
        case .simulateRelaunch:
            dismissCommandPalette()
            simulateRelaunch()
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
        window?.makeFirstResponder(self)
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
            message: "This stops its machine and all \(count) terminal \(count == 1 ? "session" : "sessions").",
            consequence: "The workspace and private project copy remain. It can be started again later.",
            confirmTitle: "Stop workspace"
        ) { [weak self] in
            self?.stopWorkspace(workspace)
        }
    }

    private func confirmDeleteSelectedWorkspace() {
        guard let workspace = selectedWorkspace() else { return }
        presentConfirmation(
            heading: "Delete workspace \(workspace)?",
            message: "This removes the workspace, its sessions, and Machinen's private project copy.",
            consequence: "This is the data-destroying action. Changes not reviewed or exported cannot be recovered.",
            confirmTitle: "Delete workspace"
        ) { [weak self] in
            self?.deleteWorkspace(workspace)
        }
    }

    private func detachSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(
            to: .detached,
            terminalText: """
            Viewer detached.

            workspace: \(tile.session.workspace)
            session:   \(tile.session.name)

            The process continues running in the workspace.
            No terminal output is being streamed to this viewer.

            Use Session: Attach viewer to reconnect.
            """
        )
        if focusedIndex != nil {
            leaveFocusedSession()
        }
    }

    private func reconnectSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(
            to: .starting,
            terminalText: """
            Reconnecting terminal…

            workspace: \(tile.session.workspace)
            session:   \(tile.session.name)

            · Locating workspace
            · Attaching to persistent PTY
            ▌
            """
        )
        Task { @MainActor [weak tile] in
            try? await Task.sleep(for: .seconds(1.0))
            guard let tile else { return }
            tile.transition(
                to: .idle,
                terminalText: """
                Attached to persistent session.

                workspace: \(tile.session.workspace)
                session:   \(tile.session.name)

                ~/workspace $ ▌
                """
            )
        }
    }

    private func restartSelectedSession() {
        guard let tile = selectedSessionTile() else { return }
        tile.transition(
            to: .starting,
            terminalText: """
            Restarting session…

            command: \(tile.session.name)
            · Starting process
            · Attaching terminal
            ▌
            """
        )
        Task { @MainActor [weak tile] in
            try? await Task.sleep(for: .seconds(1.0))
            tile?.transition(to: .idle, terminalText: "~/workspace $ \(tile?.session.name ?? "")\n\nReady.\n\n> ▌")
        }
    }

    private func stopSession(_ tile: TerminalTileView) {
        tile.transition(
            to: .stopped,
            terminalText: """
            Session stopped.

            workspace: \(tile.session.workspace)
            session:   \(tile.session.name)
            exit code: 143
            reason:    stopped by user

            The workspace is still running.
            Use Session: Restart to run this session again.
            """
        )
    }

    private func stopWorkspace(_ workspace: String) {
        for tile in allSessionTiles where tile.session.workspace == workspace {
            tile.transition(
                to: .stopped,
                terminalText: """
                Workspace stopped.

                workspace: \(workspace)
                session:   \(tile.session.name)

                The machine is stopped. The private project copy remains.
                Start or restart a session to resume this workspace.
                """
            )
        }
    }

    private func deleteWorkspace(_ workspace: String) {
        for tile in allSessionTiles where tile.session.workspace == workspace {
            tile.removeFromSuperview()
        }
        allSessionTiles.removeAll { $0.session.workspace == workspace }
        workspaceCluster(named: workspace)?.removeFromSuperview()
        workspaceClusters.removeAll { $0.workspace == workspace }
        rebuildWorkspaceClusters()
        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        updateWorldGeometry()
        updateSelection()
        setCameraImmediately()
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
            workspace id    ws_\(workspace.lowercased())_01
            placement       local · Apple Virtualization.framework
            machine state   \(sessions.allSatisfy { $0.currentState == .stopped } ? "stopped" : "running")
            private copy    ~/.machinen/workspaces/\(workspace)/project
            sessions        \(sessions.count)

            SESSION STATE
            \(sessionLines)

            CLI EQUIVALENTS
            machinen workspace inspect \(workspace)
            machinen workspace stop \(workspace)
            machinen logs --workspace \(workspace)

            Prototype diagnostics are simulated. Values are formatted as they
            should appear when backed by the real Machinen runtime.
            """
        } else if let tile = selectedSessionTile() {
            heading = "SESSION DIAGNOSTICS · \(workspace) / \(tile.session.name)"
            let lastError = tile.currentState == .disconnected
                ? "transport closed without a close frame"
                : "none"
            text = """
            workspace       \(workspace)
            session         \(tile.session.name)
            session id      ses_\(workspace.lowercased())_\(tile.session.name.lowercased())_01
            state            \(tile.currentState.rawValue)
            viewer           \(tile.currentState == .detached ? "detached" : "attached")
            placement       \(tile.currentState == .disconnected ? "studio.p4p8.local" : "local")
            pty              /dev/pts/2
            last error       \(lastError)

            ATTACH
            machinen session attach ses_\(workspace.lowercased())_\(tile.session.name.lowercased())_01

            LOGS
            machinen logs --session ses_\(workspace.lowercased())_\(tile.session.name.lowercased())_01

            LAST TERMINAL OUTPUT
            ----------------------------------------------------------------
            \(tile.currentTerminalText)
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

    private func simulateRelaunch() {
        let snapshots = allSessionTiles.map { ($0, $0.currentState, $0.currentTerminalText) }
        let restorableCount = snapshots.count { $0.1 != .stopped && $0.1 != .detached }
        let restoration = RestorationView(
            frame: bounds,
            detail: "Loading saved workspace order…\nFound \(snapshots.count) sessions; reconnecting \(restorableCount)."
        )
        restoration.layer?.zPosition = 2_000
        presentedOverlay = restoration
        addSubview(restoration, positioned: .above, relativeTo: nil)

        currentWorkspace = nil
        focusedIndex = nil
        selectedIndex = min(selectedIndex, max(0, workspaceClusters.count - 1))
        for (tile, state, _) in snapshots where state != .stopped && state != .detached {
            tile.transition(
                to: .starting,
                terminalText: "Restoring saved session…\n\n· Finding workspace\n· Reattaching viewer\n▌"
            )
        }
        updateSelection()
        moveCamera()

        Task { @MainActor [weak self, weak restoration] in
            try? await Task.sleep(for: .seconds(0.65))
            restoration?.update(detail: "Workspace order restored.\nReattaching persistent terminal viewers…")
            try? await Task.sleep(for: .seconds(0.85))
            guard let self else { return }
            for (tile, state, terminalText) in snapshots {
                tile.transition(to: state, terminalText: terminalText)
            }
            self.dismissPresentedOverlay()
        }
    }

    func handleCloseCommand() -> Bool {
        if presentedOverlay != nil {
            dismissPresentedOverlay()
            return true
        }
        if commandPalette != nil {
            dismissCommandPalette()
            return true
        }
        if focusedIndex != nil {
            detachSelectedSession()
            return true
        }
        return false
    }

    private func createSimulatedSession(workspace: String, name: String, command: String) {
        addSimulatedSession(workspace: workspace, name: name, command: command)
    }

    private func addSimulatedSession(workspace: String, name: String, command: String) {
        let tile = TerminalTileView(
            session: MockSession(
                label: nextAvailableLabel(workspace: workspace, session: name),
                workspace: workspace,
                name: name,
                state: .starting,
                terminalText: """
                Starting terminal…

                workspace: \(workspace)
                command:   \(command)

                · Preparing session
                · Connecting terminal
                ▌
                """
            )
        )
        installTile(tile)
        allSessionTiles.append(tile)
        rebuildWorkspaceClusters()
        currentWorkspace = workspace
        focusedIndex = nil
        updateWorldGeometry()
        selectedIndex = max(0, activeSessionTiles.count - 1)
        updateSelection()
        moveCamera()

        Task { @MainActor [weak self, weak tile] in
            try? await Task.sleep(for: .seconds(1.15))
            guard let self, let tile,
                  let index = self.activeSessionTiles.firstIndex(where: { $0 === tile })
            else { return }
            tile.transition(to: .idle, terminalText: self.readyTerminalText(name: name, command: command))
            self.selectedIndex = index
            self.focusedIndex = index
            self.updateSelection()
            self.moveCamera()
        }
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

    private func readyTerminalText(name: String, command: String) -> String {
        if name == "shell" { return "~/workspace $ ▌" }
        return """
        $ \(command)

        \(name) is ready in this workspace.

        > ▌
        """
    }

    @objc private func advanceSimulatedOutput() {
        simulationTick = simulationTick >= 84 ? 38 : simulationTick + 1
        for tile in allSessionTiles {
            tile.simulationTick = simulationTick
        }
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
            title = "MACHINEN / \(currentWorkspace) · \(activeSessionTiles.count) LIVE SESSIONS"
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
    private var worldSize = NSSize.zero

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    func setWorldSize(_ size: NSSize) {
        worldSize = size
        super.setBoundsSize(size)
    }

    func restoreWorldBounds() {
        super.setBoundsOrigin(.zero)
        super.setBoundsSize(worldSize)
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        if worldSize.width > 0, worldSize.height > 0 {
            super.setBoundsSize(worldSize)
        }
    }
}
