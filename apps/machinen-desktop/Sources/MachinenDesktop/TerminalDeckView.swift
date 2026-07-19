import AppKit

final class TerminalDeckView: NSView {
    private struct DragState {
        let tile: TerminalTileView
        let startPoint: NSPoint
        let offset: NSPoint
        var hasMoved = false
    }

    private enum Metrics {
        static let topInset: CGFloat = 58
        static let bottomInset: CGFloat = 54
        static let sideInset: CGFloat = 28
        static let windowControlsInset: CGFloat = 92
        static let gap: CGFloat = 22
        static let tileAspectRatio: CGFloat = 1.58
        static let minimumTileWidth: CGFloat = 250
        static let maximumColumns = 3
    }

    private var terminalTiles: [TerminalTileView]
    private var selectedIndex = 0
    private var labelBuffer = ""
    private var focusedIndex: Int?
    private var isTransitioning = false
    private var simulationTick = 38
    private var simulatedOutputTimer: Timer?
    private var isPeeking = false
    private var peekFrames: [NSRect] = []
    private var dragState: DragState?
    private var gridColumnCount = 1
    private var commandPalette: CommandPaletteView?

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(sessions: [MockSession]) {
        terminalTiles = sessions.map(TerminalTileView.init)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor

        for tile in terminalTiles {
            tile.onSelect = { [weak self, weak tile] in
                guard let self, let tile,
                      let index = self.terminalTiles.firstIndex(where: { $0 === tile })
                else {
                    return
                }
                self.select(index)
            }
            tile.onActivate = { [weak self, weak tile] in
                guard let self, let tile,
                      let index = self.terminalTiles.firstIndex(where: { $0 === tile })
                else {
                    return
                }
                self.activate(index)
            }
            tile.onDragBegan = { [weak self, weak tile] event in
                guard let tile else { return }
                self?.beginDrag(tile: tile, event: event)
            }
            tile.onDragChanged = { [weak self] event in
                self?.continueDrag(event: event)
            }
            tile.onDragEnded = { [weak self] event in
                self?.endDrag(event: event)
            }
            addSubview(tile)
        }
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

    override func keyDown(with event: NSEvent) {
        guard focusedIndex == nil, !isTransitioning else {
            return
        }
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
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
                if !event.isARepeat {
                    beginPeek()
                }
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

    override func layout() {
        super.layout()
        guard !isTransitioning, !isPeeking, dragState == nil else { return }
        if let focusedIndex, terminalTiles.indices.contains(focusedIndex) {
            terminalTiles[focusedIndex].frame = focusedFrame().integral
            return
        }
        let frames = gridFrames(count: terminalTiles.count, in: bounds)
        for (tile, frame) in zip(terminalTiles, frames) {
            tile.frame = frame.integral
            tile.needsDisplay = true
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
        bounds.fill()
        if focusedIndex == nil, !isTransitioning {
            drawMetadata()
            drawKeyHints()
        }
    }

    private func gridFrames(count: Int, in bounds: NSRect) -> [NSRect] {
        guard count > 0 else { return [] }

        let columns = columnsForGrid(count: count, in: bounds)
        gridColumnCount = columns
        let rows = Int(ceil(Double(count) / Double(columns)))
        let content = NSRect(
            x: Metrics.sideInset,
            y: Metrics.topInset,
            width: max(0, bounds.width - Metrics.sideInset * 2),
            height: max(0, bounds.height - Metrics.topInset - Metrics.bottomInset)
        )

        let availableWidth = (content.width - Metrics.gap * CGFloat(columns - 1)) / CGFloat(columns)
        let availableHeight = (content.height - Metrics.gap * CGFloat(rows - 1)) / CGFloat(rows)

        let tileWidth: CGFloat
        let tileHeight: CGFloat
        if availableWidth / availableHeight > Metrics.tileAspectRatio {
            tileHeight = availableHeight
            tileWidth = tileHeight * Metrics.tileAspectRatio
        } else {
            tileWidth = availableWidth
            tileHeight = tileWidth / Metrics.tileAspectRatio
        }

        let totalWidth = tileWidth * CGFloat(columns) + Metrics.gap * CGFloat(columns - 1)
        let totalHeight = tileHeight * CGFloat(rows) + Metrics.gap * CGFloat(rows - 1)
        let originX = content.minX + (content.width - totalWidth) / 2
        let originY = content.minY + (content.height - totalHeight) / 2

        return (0..<count).map { index in
            let column = index % columns
            let row = index / columns
            return NSRect(
                x: originX + CGFloat(column) * (tileWidth + Metrics.gap),
                y: originY + CGFloat(row) * (tileHeight + Metrics.gap),
                width: tileWidth,
                height: tileHeight
            )
        }
    }

    private func columnsForGrid(count: Int, in bounds: NSRect) -> Int {
        let contentWidth = max(0, bounds.width - Metrics.sideInset * 2)
        let fittingColumns = Int(
            floor((contentWidth + Metrics.gap) / (Metrics.minimumTileWidth + Metrics.gap))
        )
        return max(1, min(count, Metrics.maximumColumns, fittingColumns))
    }

    private func select(_ index: Int) {
        guard terminalTiles.indices.contains(index) else { return }
        selectedIndex = index
        updateSelection()
    }

    private func updateSelection() {
        for (index, tile) in terminalTiles.enumerated() {
            tile.isSelected = index == selectedIndex
        }
        needsDisplay = true
    }

    private func moveSelection(horizontal: Int, vertical: Int) {
        guard !terminalTiles.isEmpty else { return }
        clearLabelBuffer()

        let columns = gridColumnCount
        let currentRow = selectedIndex / columns
        let currentColumn = selectedIndex % columns
        let nextRow = currentRow + vertical
        let nextColumn = currentColumn + horizontal

        guard nextRow >= 0, nextColumn >= 0, nextColumn < columns else { return }
        let nextIndex = nextRow * columns + nextColumn
        guard terminalTiles.indices.contains(nextIndex) else { return }
        select(nextIndex)
    }

    private func reorderSelection(horizontal: Int, vertical: Int) {
        guard focusedIndex == nil, !isTransitioning, !isPeeking, dragState == nil else {
            return
        }
        let columns = gridColumnCount
        let currentRow = selectedIndex / columns
        let currentColumn = selectedIndex % columns
        let nextRow = currentRow + vertical
        let nextColumn = currentColumn + horizontal
        guard nextRow >= 0, nextColumn >= 0, nextColumn < columns else { return }

        let targetIndex = nextRow * columns + nextColumn
        guard terminalTiles.indices.contains(targetIndex) else { return }
        terminalTiles.swapAt(selectedIndex, targetIndex)
        selectedIndex = targetIndex
        updateSelection()
        animateOverviewLayout()
    }

    private func beginPeek() {
        guard focusedIndex == nil, !isTransitioning, !isPeeking, dragState == nil,
              terminalTiles.indices.contains(selectedIndex)
        else {
            return
        }

        clearLabelBuffer()
        peekFrames = gridFrames(count: terminalTiles.count, in: bounds)
        isPeeking = true
        needsDisplay = true

        let selectedTile = terminalTiles[selectedIndex]
        selectedTile.isFocused = true
        selectedTile.layer?.zPosition = 100
        let available = bounds.insetBy(dx: 4, dy: 4)
        let aspectRatio = selectedTile.frame.width / max(1, selectedTile.frame.height)
        let targetFrame: NSRect
        if available.width / available.height > aspectRatio {
            let width = available.height * aspectRatio
            targetFrame = NSRect(
                x: available.midX - width / 2,
                y: available.minY,
                width: width,
                height: available.height
            )
        } else {
            let height = available.width / aspectRatio
            targetFrame = NSRect(
                x: available.minX,
                y: available.midY - height / 2,
                width: available.width,
                height: height
            )
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.14
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            selectedTile.animator().frame = targetFrame.integral
            for (index, tile) in terminalTiles.enumerated() where index != selectedIndex {
                tile.animator().alphaValue = 0
            }
        }
    }

    private func endPeek() {
        guard isPeeking, terminalTiles.indices.contains(selectedIndex),
              peekFrames.count == terminalTiles.count
        else {
            return
        }

        let selectedTile = terminalTiles[selectedIndex]
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.14
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            for (tile, frame) in zip(terminalTiles, peekFrames) {
                tile.animator().frame = frame.integral
                tile.animator().alphaValue = 1
            }
        } completionHandler: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                selectedTile.isFocused = false
                selectedTile.layer?.zPosition = 0
                self.peekFrames = []
                self.isPeeking = false
                self.updateSelection()
                self.needsDisplay = true
            }
        }
    }

    private func beginDrag(tile: TerminalTileView, event: NSEvent) {
        guard focusedIndex == nil, !isTransitioning, !isPeeking, dragState == nil else {
            return
        }
        let point = convert(event.locationInWindow, from: nil)
        dragState = DragState(
            tile: tile,
            startPoint: point,
            offset: NSPoint(x: point.x - tile.frame.minX, y: point.y - tile.frame.minY)
        )
    }

    private func continueDrag(event: NSEvent) {
        guard var state = dragState,
              let currentIndex = terminalTiles.firstIndex(where: { $0 === state.tile })
        else {
            return
        }

        let point = convert(event.locationInWindow, from: nil)
        if !state.hasMoved {
            let distance = hypot(point.x - state.startPoint.x, point.y - state.startPoint.y)
            guard distance >= 4 else { return }
            state.hasMoved = true
            state.tile.layer?.zPosition = 200
        }

        state.tile.frame.origin = NSPoint(
            x: point.x - state.offset.x,
            y: point.y - state.offset.y
        )

        let targetFrames = gridFrames(count: terminalTiles.count, in: bounds)
        if let targetIndex = targetFrames.firstIndex(where: { $0.contains(point) }),
           targetIndex != currentIndex
        {
            terminalTiles.remove(at: currentIndex)
            terminalTiles.insert(state.tile, at: targetIndex)
            selectedIndex = targetIndex
            updateSelection()
            animateOverviewLayout(excluding: state.tile)
        }
        dragState = state
    }

    private func endDrag(event _: NSEvent) {
        guard let state = dragState else { return }
        dragState = nil
        guard state.hasMoved,
              let finalIndex = terminalTiles.firstIndex(where: { $0 === state.tile })
        else {
            return
        }

        let frames = gridFrames(count: terminalTiles.count, in: bounds)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.14
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            state.tile.animator().frame = frames[finalIndex].integral
        } completionHandler: {
            Task { @MainActor in
                state.tile.layer?.zPosition = 0
            }
        }
    }

    private func animateOverviewLayout(excluding excludedTile: TerminalTileView? = nil) {
        let frames = gridFrames(count: terminalTiles.count, in: bounds)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.14
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            for (tile, frame) in zip(terminalTiles, frames) where tile !== excludedTile {
                tile.animator().frame = frame.integral
            }
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

        let matches = terminalTiles.indices.filter {
            terminalTiles[$0].session.label.hasPrefix(labelBuffer)
        }
        for (index, tile) in terminalTiles.enumerated() {
            tile.alphaValue = matches.contains(index) ? 1 : 0.28
        }
        if let firstMatch = matches.first {
            select(firstMatch)
        }
        if let exactMatch = matches.first(where: {
            terminalTiles[$0].session.label == labelBuffer
        }) {
            activate(exactMatch)
        }
        needsDisplay = true
    }

    private func clearLabelBuffer() {
        labelBuffer = ""
        for tile in terminalTiles {
            tile.alphaValue = 1
        }
        needsDisplay = true
    }

    @objc private func clearLabelBufferAfterDelay() {
        clearLabelBuffer()
    }

    func toggleCommandPalette() {
        if commandPalette != nil {
            dismissCommandPalette()
            return
        }
        guard !isTransitioning, !isPeeking, dragState == nil,
              terminalTiles.indices.contains(focusedIndex ?? selectedIndex)
        else {
            return
        }

        let contextIndex = focusedIndex ?? selectedIndex
        let session = terminalTiles[contextIndex].session
        let palette = CommandPaletteView(
            frame: bounds,
            context: "\(session.workspace) / \(session.name)",
            commands: paletteCommands(for: session)
        )
        palette.layer?.zPosition = 1_000
        palette.onDismiss = { [weak self] in
            self?.dismissCommandPalette()
        }
        palette.onRun = { [weak self, weak palette] command in
            self?.runPaletteCommand(command, from: palette)
        }
        commandPalette = palette
        addSubview(palette, positioned: .above, relativeTo: nil)
        window?.makeFirstResponder(palette)
    }

    private func dismissCommandPalette() {
        commandPalette?.removeFromSuperview()
        commandPalette = nil
        window?.makeFirstResponder(self)
    }

    private func paletteCommands(for session: MockSession) -> [PaletteCommand] {
        let viewCommand = focusedIndex == nil
            ? "View: Focus selected session"
            : "View: Show session overview"
        return [
            PaletteCommand(id: .toggleOverview, title: viewCommand, shortcut: "left⌘ + right⌘"),
            PaletteCommand(id: .newTerminal, title: "Session: New terminal in \(session.workspace)…", shortcut: "⌘T"),
            PaletteCommand(id: .focusSession, title: "Session: Focus another session…", shortcut: "⌘P"),
            PaletteCommand(id: .openPreview, title: "Workspace: Open preview", shortcut: ""),
            PaletteCommand(id: .reviewChanges, title: "Workspace: Review changes", shortcut: ""),
            PaletteCommand(id: .detachSession, title: "Session: Detach viewer", shortcut: ""),
            PaletteCommand(id: .restartSession, title: "Session: Restart \(session.name)", shortcut: ""),
            PaletteCommand(id: .stopSession, title: "Session: Stop \(session.name)", shortcut: ""),
            PaletteCommand(id: .inspectWorkspace, title: "Workspace: Inspect machine…", shortcut: ""),
        ]
    }

    private func runPaletteCommand(_ command: PaletteCommand, from palette: CommandPaletteView?) {
        if command.id == .toggleOverview {
            dismissCommandPalette()
            toggleOverview()
            return
        }
        palette?.showStatus("Prototype only · \(command.title)")
    }

    func toggleOverview() {
        if commandPalette != nil {
            dismissCommandPalette()
            if focusedIndex != nil {
                returnToOverview()
            }
            return
        }
        guard !isTransitioning, !isPeeking, dragState == nil else { return }
        if focusedIndex == nil {
            activate(selectedIndex)
        } else {
            returnToOverview()
        }
    }

    private func activate(_ index: Int) {
        guard terminalTiles.indices.contains(index), focusedIndex == nil, !isTransitioning else {
            return
        }
        select(index)
        clearLabelBuffer()
        isTransitioning = true
        needsDisplay = true

        let selectedTile = terminalTiles[index]
        selectedTile.isFocused = true
        selectedTile.layer?.zPosition = 100
        let targetFrame = focusedFrame().integral

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            selectedTile.animator().frame = targetFrame
            for (tileIndex, tile) in terminalTiles.enumerated() where tileIndex != index {
                tile.animator().alphaValue = 0
            }
        } completionHandler: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.focusedIndex = index
                self.isTransitioning = false
                for (tileIndex, tile) in self.terminalTiles.enumerated() where tileIndex != index {
                    tile.isHidden = true
                }
                self.needsDisplay = true
            }
        }
    }

    private func returnToOverview() {
        guard let focusedIndex, terminalTiles.indices.contains(focusedIndex), !isTransitioning else {
            return
        }
        isTransitioning = true
        needsDisplay = true

        let frames = gridFrames(count: terminalTiles.count, in: bounds)
        terminalTiles[focusedIndex].isFocused = false
        for (index, tile) in terminalTiles.enumerated() where index != focusedIndex {
            tile.isHidden = false
            tile.alphaValue = 0
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            for (tile, frame) in zip(terminalTiles, frames) {
                tile.animator().frame = frame.integral
                tile.animator().alphaValue = 1
            }
        } completionHandler: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.terminalTiles[focusedIndex].layer?.zPosition = 0
                self.focusedIndex = nil
                self.isTransitioning = false
                self.updateSelection()
                self.window?.makeFirstResponder(self)
                self.needsDisplay = true
            }
        }
    }

    private func focusedFrame() -> NSRect {
        bounds
    }

    @objc private func advanceSimulatedOutput() {
        simulationTick = simulationTick >= 84 ? 38 : simulationTick + 1
        for tile in terminalTiles {
            tile.simulationTick = simulationTick
        }
    }

    private func drawMetadata() {
        drawLabel(
            "MACHINEN · \(terminalTiles.count) LIVE SESSIONS",
            x: Metrics.windowControlsInset,
            alignment: .left
        )
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
        let width = min(360, max(0, bounds.width - Metrics.sideInset * 2))
        let rectX = alignment == .left ? x : x - width
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.56, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: rectX, y: 20, width: width, height: 18)
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
        } else {
            text = "arrows  select     return  open     hold space  peek     drag or ⌘+arrows  reorder"
        }
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: Metrics.sideInset, y: bounds.height - 31, width: bounds.width - Metrics.sideInset * 2, height: 16)
        )
    }
}
