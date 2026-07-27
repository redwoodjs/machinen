import AppKit

final class WorkspaceClusterView: NSView {
    private enum Metrics {
        static let padding: CGFloat = 24
        static let headerHeight: CGFloat = 40
        static let gap: CGFloat = 30
        static let cornerRadius: CGFloat = 18
    }

    let workspaceID: String
    var workspace: String {
        didSet {
            setAccessibilityLabel("Workspace \(workspace)")
            needsDisplay = true
        }
    }
    let label: String
    private(set) var sessions: [TerminalTileView] = []
    private(set) var sessionColumns = 1

    var onSelect: (() -> Void)?
    var onActivate: (() -> Void)?
    var onDragBegan: ((NSEvent) -> Void)?
    var onDragChanged: ((NSEvent) -> Void)?
    var onDragEnded: ((NSEvent) -> Bool)?
    private var isTrackingPointer = false

    var isSelected = false {
        didSet { needsDisplay = true }
    }

    var isEntered = false {
        didSet { needsDisplay = true }
    }

    var isDragTarget = false {
        didSet { needsDisplay = true }
    }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { false }

    init(workspaceID: String, workspace: String, label: String) {
        self.workspaceID = workspaceID
        self.workspace = workspace
        self.label = label
        super.init(frame: .zero)
        wantsLayer = true
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
        if sessions.count == 1, let tile = sessions.first {
            // A singleton is already the workspace's complete live surface.
            // Do not shrink it into a card with decorative workspace padding.
            for subview in subviews where subview !== tile {
                subview.removeFromSuperview()
            }
            if tile.superview !== self {
                addSubview(tile)
            }
            sessionColumns = 1
            tile.frame = NSRect(origin: .zero, size: terminalSize).integral
            tile.bounds = NSRect(origin: .zero, size: terminalSize)
            tile.isHidden = false
            tile.alphaValue = 1
            return terminalSize
        }

        let content = NSRect(
            x: Metrics.padding,
            y: Metrics.headerHeight,
            width: max(1, terminalSize.width - Metrics.padding * 2),
            height: max(1, terminalSize.height - Metrics.headerHeight - Metrics.padding)
        )
        sessionColumns = bestColumnCount(
            itemCount: sessions.count,
            contentSize: content.size,
            terminalSize: terminalSize
        )
        let rows = max(1, Int(ceil(Double(sessions.count) / Double(sessionColumns))))
        let cellWidth = (content.width - Metrics.gap * CGFloat(max(0, sessionColumns - 1)))
            / CGFloat(sessionColumns)
        let cellHeight = (content.height - Metrics.gap * CGFloat(max(0, rows - 1)))
            / CGFloat(rows)
        let tileScale = min(cellWidth / terminalSize.width, cellHeight / terminalSize.height)
        let tileSize = NSSize(
            width: terminalSize.width * tileScale,
            height: terminalSize.height * tileScale
        )

        for subview in subviews where !sessions.contains(where: { $0 === subview }) {
            subview.removeFromSuperview()
        }
        for (index, tile) in sessions.enumerated() {
            if tile.superview !== self {
                addSubview(tile)
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
                x: cell.midX - tileSize.width / 2,
                y: cell.midY - tileSize.height / 2,
                width: tileSize.width,
                height: tileSize.height
            ).integral
            // Every terminal keeps one full-screen intrinsic surface. Its frame
            // is merely the scaled slot inside this uniform workspace screen.
            tile.bounds = NSRect(origin: .zero, size: terminalSize)
            tile.isHidden = false
            tile.alphaValue = 1
        }
        return terminalSize
    }

    private func bestColumnCount(
        itemCount: Int,
        contentSize: NSSize,
        terminalSize: NSSize
    ) -> Int {
        guard itemCount > 1 else { return 1 }
        var bestColumns = 1
        var bestScale: CGFloat = 0
        for columns in 1...itemCount {
            let rows = Int(ceil(Double(itemCount) / Double(columns)))
            let width = (contentSize.width - Metrics.gap * CGFloat(columns - 1)) / CGFloat(columns)
            let height = (contentSize.height - Metrics.gap * CGFloat(rows - 1)) / CGFloat(rows)
            let scale = min(width / terminalSize.width, height / terminalSize.height)
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

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        NSColor(calibratedWhite: 0.075, alpha: 0.96).setFill()
        let cornerRadius = isEntered ? 0 : Metrics.cornerRadius
        NSBezierPath(
            roundedRect: bounds,
            xRadius: cornerRadius,
            yRadius: cornerRadius
        ).fill()

        if !isEntered {
            let border = NSBezierPath(
                roundedRect: bounds.insetBy(dx: 2, dy: 2),
                xRadius: Metrics.cornerRadius - 2,
                yRadius: Metrics.cornerRadius - 2
            )
            border.lineWidth = isSelected || isDragTarget ? 6 : 2
            (isDragTarget ? NSColor.controlAccentColor : NSColor(calibratedWhite: isSelected ? 0.94 : 0.28, alpha: 1)).setStroke()
            border.stroke()
        }

        if !isEntered {
            let titleParagraph = NSMutableParagraphStyle()
            titleParagraph.lineBreakMode = .byTruncatingTail
            let titleAttributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 18, weight: .semibold),
                .foregroundColor: NSColor(calibratedWhite: 0.82, alpha: 1),
                .paragraphStyle: titleParagraph,
            ]
            NSAttributedString(string: workspace, attributes: titleAttributes).draw(
                in: NSRect(x: Metrics.padding, y: 8, width: bounds.width * 0.58, height: 24)
            )

            let detailParagraph = NSMutableParagraphStyle()
            detailParagraph.alignment = .right
            detailParagraph.lineBreakMode = .byTruncatingTail
            let count = sessions.count
            let detail = "\(label) · \(count)"
            let detailAttributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 13, weight: .regular),
                .foregroundColor: NSColor(calibratedWhite: 0.48, alpha: 1),
                .paragraphStyle: detailParagraph,
            ]
            NSAttributedString(string: detail, attributes: detailAttributes).draw(
                in: NSRect(
                    x: bounds.width * 0.5,
                    y: 10,
                    width: bounds.width * 0.5 - Metrics.padding,
                    height: 20
                )
            )
        }
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
