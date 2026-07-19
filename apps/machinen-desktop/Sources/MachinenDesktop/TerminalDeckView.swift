import AppKit

final class TerminalDeckView: NSView {
    private enum Metrics {
        static let topInset: CGFloat = 58
        static let bottomInset: CGFloat = 54
        static let sideInset: CGFloat = 28
        static let gap: CGFloat = 22
        static let tileAspectRatio: CGFloat = 1.58
    }

    private let terminalTiles: [TerminalTileView]
    private var selectedIndex = 0
    private var labelBuffer = ""
    private var focusedIndex: Int?
    private var isTransitioning = false
    private var simulationTick = 38
    private var simulatedOutputTimer: Timer?

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    init(sessions: [MockSession]) {
        terminalTiles = sessions.map(TerminalTileView.init)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1).cgColor

        for (index, tile) in terminalTiles.enumerated() {
            tile.onSelect = { [weak self] in
                self?.select(index)
            }
            tile.onActivate = { [weak self] in
                self?.activate(index)
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

    override func layout() {
        super.layout()
        guard !isTransitioning else { return }
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
        if focusedIndex != nil || isTransitioning {
            drawFocusedHint()
        } else {
            drawMetadata()
            drawKeyHints()
        }
    }

    private func gridFrames(count: Int, in bounds: NSRect) -> [NSRect] {
        guard count > 0 else { return [] }

        let columns = Int(ceil(sqrt(Double(count))))
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

        let columns = Int(ceil(sqrt(Double(terminalTiles.count))))
        let currentRow = selectedIndex / columns
        let currentColumn = selectedIndex % columns
        let nextRow = currentRow + vertical
        let nextColumn = currentColumn + horizontal

        guard nextRow >= 0, nextColumn >= 0, nextColumn < columns else { return }
        let nextIndex = nextRow * columns + nextColumn
        guard terminalTiles.indices.contains(nextIndex) else { return }
        select(nextIndex)
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

    func toggleOverview() {
        guard !isTransitioning else { return }
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
        bounds.insetBy(dx: 20, dy: 20)
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
            x: Metrics.sideInset,
            alignment: .left
        )
        drawLabel(
            "⌘K  commands     ⌘T  new terminal",
            x: bounds.width - Metrics.sideInset,
            alignment: .right
        )
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

    private func drawFocusedHint() {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 9, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 0.48, alpha: 1),
            .paragraphStyle: paragraph,
        ]
        NSAttributedString(
            string: "left ⌘ + right ⌘   session overview",
            attributes: attributes
        ).draw(
            in: NSRect(x: 200, y: bounds.height - 16, width: max(0, bounds.width - 400), height: 12)
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
            text = "arrows  select     type label  focus     return  open"
        }
        NSAttributedString(string: text, attributes: attributes).draw(
            in: NSRect(x: Metrics.sideInset, y: bounds.height - 31, width: bounds.width - Metrics.sideInset * 2, height: 16)
        )
    }
}
