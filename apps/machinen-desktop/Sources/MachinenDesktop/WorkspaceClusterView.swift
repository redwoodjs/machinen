import AppKit

private final class WorkspaceBorderView: NSView {
    override var isOpaque: Bool { false }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }
}

final class WorkspaceClusterView: NSView {
    enum RenderingMode: Equatable {
        case workspace
        case newWorkspace
        case ghost
    }

    private enum Metrics {
        static let padding: CGFloat = 12
        static let gap: CGFloat = 16
        static let cornerRadius: CGFloat = 18
        static let borderWidth: CGFloat = 1
        static let selectedBorderWidth: CGFloat = 4
    }

    let workspaceID: String
    var renderingMode: RenderingMode {
        didSet {
            updateBorderAppearance()
            needsDisplay = true
        }
    }
    var workspace: String {
        didSet {
            setAccessibilityLabel("Workspace \(workspace)")
            needsDisplay = true
        }
    }
    let label: String
    private(set) var sessions: [TerminalTileView] = []
    private(set) var sessionColumns = 1
    // Keep workspace chrome above a singleton terminal that fills the cluster.
    private let borderView = WorkspaceBorderView()

    var onSelect: (() -> Void)?
    var onActivate: (() -> Void)?
    var onDragBegan: ((NSEvent) -> Void)?
    var onDragChanged: ((NSEvent) -> Void)?
    var onDragEnded: ((NSEvent) -> Bool)?
    private var isTrackingPointer = false

    var isSelected = false {
        didSet {
            updateBorderAppearance()
            if renderingMode != .workspace { needsDisplay = true }
        }
    }

    var selectionBorderAlpha: CGFloat = 1 {
        didSet { updateBorderAppearance() }
    }

    var isEntered = false {
        didSet {
            updateBorderAppearance()
            needsDisplay = true
        }
    }

    var isDragTarget = false {
        didSet { updateBorderAppearance() }
    }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { false }

    init(
        workspaceID: String,
        workspace: String,
        label: String,
        renderingMode: RenderingMode = .workspace
    ) {
        self.workspaceID = workspaceID
        self.workspace = workspace
        self.label = label
        self.renderingMode = renderingMode
        super.init(frame: .zero)
        wantsLayer = true
        borderView.wantsLayer = true
        borderView.layer?.backgroundColor = NSColor.clear.cgColor
        borderView.layer?.cornerRadius = Metrics.cornerRadius
        borderView.layer?.actions = [
            "borderColor": NSNull(),
            "borderWidth": NSNull(),
            "hidden": NSNull(),
        ]
        borderView.setAccessibilityElement(false)
        addSubview(borderView)
        updateBorderAppearance()
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Workspace \(workspace)")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @discardableResult
    func arrange(sessions: [TerminalTileView], terminalSize: NSSize) -> NSSize {
        self.sessions = sessions
        let cardSize = TerminalTileView.cardSize(for: terminalSize)
        if renderingMode != .workspace {
            sessionColumns = 1
            return cardSize
        }
        if sessions.count == 1, let tile = sessions.first {
            // A singleton is already the workspace's complete live surface.
            // Do not shrink it into a card with decorative workspace padding.
            for subview in subviews where subview !== tile && subview !== borderView {
                subview.removeFromSuperview()
            }
            if tile.superview !== self {
                addSubview(tile, positioned: .below, relativeTo: borderView)
            }
            sessionColumns = 1
            tile.frame = NSRect(origin: .zero, size: cardSize).integral
            tile.bounds = NSRect(origin: .zero, size: cardSize)
            tile.isHidden = false
            tile.alphaValue = 1
            return cardSize
        }

        let content = NSRect(origin: .zero, size: cardSize)
            .insetBy(dx: Metrics.padding, dy: Metrics.padding)
        sessionColumns = bestColumnCount(
            itemCount: sessions.count,
            contentSize: content.size,
            cardSize: cardSize
        )
        let rows = max(1, Int(ceil(Double(sessions.count) / Double(sessionColumns))))
        let cellWidth = (content.width - Metrics.gap * CGFloat(max(0, sessionColumns - 1)))
            / CGFloat(sessionColumns)
        let cellHeight = (content.height - Metrics.gap * CGFloat(max(0, rows - 1)))
            / CGFloat(rows)
        let tileScale = min(cellWidth / cardSize.width, cellHeight / cardSize.height)
        let scaledCardSize = NSSize(
            width: cardSize.width * tileScale,
            height: cardSize.height * tileScale
        )

        for subview in subviews where subview !== borderView
            && !sessions.contains(where: { $0 === subview })
        {
            subview.removeFromSuperview()
        }
        for (index, tile) in sessions.enumerated() {
            if tile.superview !== self {
                addSubview(tile, positioned: .below, relativeTo: borderView)
            }
            let column = index % sessionColumns
            let row = index / sessionColumns
            let cell = NSRect(
                x: content.minX + CGFloat(column) * (cellWidth + Metrics.gap),
                y: content.minY + CGFloat(row) * (cellHeight + Metrics.gap),
                width: cellWidth,
                height: cellHeight
            )
            tile.frame = NSRect(
                x: cell.midX - scaledCardSize.width / 2,
                y: cell.midY - scaledCardSize.height / 2,
                width: scaledCardSize.width,
                height: scaledCardSize.height
            ).integral
            // Every terminal keeps one full-screen intrinsic surface below its
            // caption. Its frame is only the scaled workspace-preview slot.
            tile.bounds = NSRect(origin: .zero, size: cardSize)
            tile.isHidden = false
            tile.alphaValue = 1
        }
        return cardSize
    }

    override func layout() {
        super.layout()
        borderView.frame = bounds
    }

    private func bestColumnCount(
        itemCount: Int,
        contentSize: NSSize,
        cardSize: NSSize
    ) -> Int {
        guard itemCount > 1 else { return 1 }
        var bestColumns = 1
        var bestScale: CGFloat = 0
        for columns in 1...itemCount {
            let rows = Int(ceil(Double(itemCount) / Double(columns)))
            let width = (contentSize.width - Metrics.gap * CGFloat(columns - 1)) / CGFloat(columns)
            let height = (contentSize.height - Metrics.gap * CGFloat(rows - 1)) / CGFloat(rows)
            let scale = min(width / cardSize.width, height / cardSize.height)
            if scale > bestScale {
                bestScale = scale
                bestColumns = columns
            }
        }
        return bestColumns
    }

    func frameForSession(_ tile: TerminalTileView, in view: NSView) -> NSRect? {
        guard tile.superview === self else { return nil }
        return tile.convert(tile.bounds, to: view)
    }

    func frameForTerminalViewport(_ tile: TerminalTileView, in view: NSView) -> NSRect? {
        guard tile.superview === self else { return nil }
        return tile.convert(tile.terminalViewportRect, to: view)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let cornerRadius = isEntered ? 0 : Metrics.cornerRadius
        switch renderingMode {
        case .workspace:
            NSColor(calibratedWhite: 0.075, alpha: 0.96).setFill()
            NSBezierPath(roundedRect: bounds, xRadius: cornerRadius, yRadius: cornerRadius).fill()
        case .newWorkspace, .ghost:
            let color = renderingMode == .newWorkspace
                ? NSColor.systemBlue
                : NSColor.secondaryLabelColor
            let path = NSBezierPath(
                roundedRect: bounds.insetBy(dx: 2, dy: 2),
                xRadius: Metrics.cornerRadius,
                yRadius: Metrics.cornerRadius
            )
            path.setLineDash([9, 7], count: 2, phase: 0)
            color.setStroke()
            path.lineWidth = isSelected ? 4 : 2
            path.stroke()
            let title = renderingMode == .newWorkspace ? "+ Add workspace" : "ghost: \(workspace)"
            title.draw(
                in: NSRect(x: 24, y: bounds.midY - 10, width: bounds.width - 48, height: 20),
                withAttributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .medium),
                    .foregroundColor: color,
                ]
            )
        }
    }

    private func updateBorderAppearance() {
        borderView.isHidden = isEntered || renderingMode != .workspace
        borderView.layer?.borderWidth = isSelected || isDragTarget
            ? Metrics.selectedBorderWidth
            : Metrics.borderWidth
        borderView.layer?.borderColor = (
            isDragTarget
                ? NSColor.controlAccentColor
                : isSelected
                    ? NSColor.controlAccentColor.withAlphaComponent(selectionBorderAlpha)
                    : NSColor(calibratedWhite: 0.28, alpha: 1)
        ).cgColor
    }

    override func mouseDown(with event: NSEvent) {
        guard event.clickCount < 2 else {
            isTrackingPointer = false
            onActivate?()
            return
        }
        isTrackingPointer = true
        onDragBegan?(event)
    }

    override func mouseDragged(with event: NSEvent) {
        guard isTrackingPointer else { return }
        onDragChanged?(event)
    }

    override func mouseUp(with event: NSEvent) {
        guard isTrackingPointer else { return }
        isTrackingPointer = false
        let consumedByDrag = onDragEnded?(event) ?? false
        if !consumedByDrag {
            onSelect?()
        }
    }
}
